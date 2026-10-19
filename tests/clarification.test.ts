import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { demoProvider } from '../server/ai/demo.js';
import { chatResponseSchema, modelAnswerSchema, type ChatContext } from '../shared/contracts.js';
import { suggestion } from './fixtures.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', CHAT_RATE_LIMIT: '120' });
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const generate = vi.fn(demoProvider.generate);
const embed = vi.fn(demoProvider.embed);
async function chat(message: string, history: string[] = [], context?: ChatContext | null) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { message, history, context: context ?? undefined },
  });
  expect(response.statusCode).toBe(200);
  return chatResponseSchema.parse(response.json());
}
beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await loadPublicCatalog(db);
  app = await buildApp(config, db, { ...demoProvider, generate, embed });
});
beforeEach(() => {
  generate.mockReset().mockImplementation(demoProvider.generate);
  embed.mockClear();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Esclarecimento condicional e continuidade', () => {
  it.each(['estou com dor de cabeça', 'estou sentindo muita dor no pescoço', 'estou com dor'])(
    'pede detalhes para relato genérico: %s',
    async (message) => {
      // Even an overconfident model cannot skip the minimum context.
      generate.mockResolvedValueOnce(suggestion('Neurologia'));
      const result = await chat(message);
      expect(result).toMatchObject({
        status: 'needs_information',
        specialty: null,
        clinics: [],
        sources: [],
        ragStatus: 'skipped',
      });
      expect(result.questions).toHaveLength(2);
      expect(result.questions.join(' ')).toContain('Há quanto tempo');
      if (message.includes('cabeça'))
        expect(result.questions.join(' ')).toContain('região da cabeça');
      if (message.includes('pescoço'))
        expect(result.questions.join(' ')).toContain('movimentar o pescoço');
      expect(result.feedback?.reasons).not.toContain('incorrect_specialty');
      expect(embed).not.toHaveBeenCalled();
    },
  );
  it('usa a resposta seguinte e recomenda uma área sem repetir as perguntas', async () => {
    const message = 'estou com dor no pescoço';
    const first = await chat(message);
    const second = await chat(
      'Desde ontem, aos poucos. Piora ao virar a cabeça, sem outros sintomas.',
      [message],
      first.context,
    );
    expect(second).toMatchObject({ status: 'ok', specialty: { id: 'ortopedia' }, questions: [] });
    expect(second.clinics.length).toBeGreaterThan(0);
    expect(second.context?.care).toBeUndefined();
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        history: [message],
        previousQuestions: first.questions,
      }),
    );
  });
  it('não exige entrevista quando o primeiro relato já tem detalhes', async () => {
    const result = await chat(
      'Dor no pescoço há dois dias, piora ao movimentar, sem outros sintomas.',
    );
    expect(result).toMatchObject({ status: 'ok', specialty: { id: 'ortopedia' }, questions: [] });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('considera resposta parcial, não repete duração e aceita esclarecimento posterior', async () => {
    const firstMessage = 'estou com dor de cabeça';
    const first = await chat(firstMessage);
    const partial = 'Começou ontem.';
    const second = await chat(partial, [firstMessage], first.context);
    expect(second.specialty).toBeNull();
    expect(second.questions.join(' ')).not.toContain('Há quanto tempo');
    expect(second.context?.care?.questions).toContain('associated_symptoms');
    const final = await chat(
      'Sem outros sintomas; é uma pressão constante.',
      [firstMessage, partial],
      second.context,
    );
    expect(final).toMatchObject({ specialty: { id: 'neurologia' }, questions: [] });
  });
  it('não força indicação nem acrescenta perguntas opcionais quando o modelo falha num relato detalhado', async () => {
    generate.mockResolvedValueOnce({
      ...suggestion(),
      specialty: null,
      urgency: 'uncertain',
      questions: ['impact'],
    });
    const result = await chat('Dor no pescoço desde ontem, sem outros sintomas.');
    expect(result.specialty).toBeNull();
    expect(result.questions).toEqual([]);
    expect(result.answer).toContain('Não consegui validar');
  });
  it('limita rodadas sem forçar recomendação ou repetir perguntas indefinidamente', async () => {
    const history: string[] = [];
    let context: ChatContext | null = null;
    const asked: string[] = [];
    for (const message of [
      'estou com dor de cabeça',
      'não sei informar',
      'não consigo explicar',
      'não sei',
    ]) {
      const result = await chat(message, history, context);
      expect(result.specialty).toBeNull();
      expect(result.clinics).toEqual([]);
      for (const question of result.questions) expect(asked).not.toContain(question);
      asked.push(...result.questions);
      history.push(message);
      context = result.context;
      if (history.length === 4) {
        expect(result.questions).toEqual([]);
        expect(result.answer).toContain('avaliação presencial');
      }
    }
  });
  it('urgência na resposta às perguntas interrompe o esclarecimento', async () => {
    const firstMessage = 'estou com dor de cabeça';
    const first = await chat(firstMessage);
    generate.mockClear();
    const result = await chat(
      'Também estou com fala enrolada e fraqueza de um lado',
      [firstMessage],
      first.context,
    );
    expect(result).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      specialty: null,
      clinics: [],
      questions: [],
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it('alerta do modelo também prevalece sobre as perguntas', async () => {
    generate.mockResolvedValueOnce({ ...suggestion(), urgency: 'prompt', specialty: null });
    const result = await chat('estou sentindo muita dor no pescoço');
    expect(result).toMatchObject({
      mode: 'safety',
      urgency: 'prompt',
      questions: [],
      specialty: null,
    });
  });
  it('nova queixa não herda duração e detalhes do relato anterior', async () => {
    const result = await chat('Agora estou com dor de cabeça', [
      'Dor no pescoço desde ontem, sem outros sintomas.',
    ]);
    expect(result).toMatchObject({ specialty: null, status: 'needs_information' });
    expect(result.questions.join(' ')).toContain('Há quanto tempo');
  });
  it('consulta ao catálogo durante esclarecimento continua sem entrevista médica', async () => {
    const first = await chat('Estou com dor de cabeça');
    generate.mockClear();
    const result = await chat(
      'Quais clínicas aceitam Unimed?',
      ['Estou com dor de cabeça'],
      first.context,
    );
    expect(result).toMatchObject({ mode: 'catalog', intent: 'clinic_search', questions: [] });
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it('perguntas não aceitam especialidades inventadas, instruções médicas ou texto livre', () => {
    for (const value of ['Procure Oculista?', 'Tome 500mg?', 'Especialista ocular avançado'])
      expect(
        modelAnswerSchema.safeParse({ ...suggestion(), specialty: null, questions: [value] })
          .success,
      ).toBe(false);
  });
});

describe('Medicina de Família fora das opções ativas', () => {
  it('retira filtro e cartões, preservando a clínica e as demais áreas', async () => {
    const meta = (await app.inject('/api/catalog')).json();
    expect(meta.specialties).toHaveLength(16);
    expect(meta.specialties.some((s: { id: string }) => s.id === 'medicina-de-familia')).toBe(
      false,
    );
    const fam = (await app.inject('/api/clinics?q=FAM')).json();
    expect(fam.items).toHaveLength(1);
    expect(fam.items[0].specialties).toEqual(expect.arrayContaining(['ortopedia', 'dermatologia']));
    expect(JSON.stringify(fam)).not.toMatch(/medicina-de-familia|Medicina de Família/);
    expect((await app.inject('/api/clinics?specialty=medicina-de-familia')).json().total).toBe(0);
  });
  it('não fornece a área ao LLM e rejeita candidata desativada', async () => {
    generate.mockResolvedValueOnce(suggestion('Médico de família'));
    const response = await chat('Dor no pescoço desde ontem, sem outros sintomas.');
    expect(response).toMatchObject({
      status: 'specialty_not_registered',
      specialty: null,
      clinics: [],
    });
    expect(generate.mock.calls[0][0].specialties?.some((s) => s.id === 'medicina-de-familia')).toBe(
      false,
    );
    expect(
      (await new SpecialtyRepository(db).resolve('Medicina de Família e Comunidade')).status,
    ).toBe('not_registered');
  });
  it('não transforma busca por área removida em lista sem filtro', async () => {
    const response = await chat('quero uma clínica de medicina de família');
    expect(response).toMatchObject({ status: 'needs_information', specialty: null, clinics: [] });
    expect(response.answer).toContain('não faz parte das opções ativas');
    expect(generate).not.toHaveBeenCalled();
  });
});
