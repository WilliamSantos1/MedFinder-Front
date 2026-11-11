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

describe('Esclarecimento enxuto e navegação híbrida', () => {
  it('dor sem local pede apenas a informação discriminante', async () => {
    const result = await chat('estou com dor');
    expect(result).toMatchObject({
      status: 'needs_information',
      specialty: null,
      clinics: [],
      ragStatus: 'skipped',
    });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toContain('parte do corpo');
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('dor de cabeça sem início nem sinais associados faz perguntas antes do encaminhamento', async () => {
    const result = await chat('estou com dor de cabeça');
    expect(result).toMatchObject({ status: 'needs_information', specialty: null, clinics: [] });
    expect(result.questions.join(' ')).toMatch(/quanto tempo|outro sintoma/i);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ['estou sentindo dor no pescoço desde ontem, piora ao movimentar, sem outros sintomas', 'ortopedia'],
    ['bom dia, meu olho está avermelhado e coçando', 'oftalmologia'],
  ])('queixa clara usa fast-path: %s', async (message, specialtyId) => {
    const result = await chat(message);
    expect(result).toMatchObject({ status: 'ok', specialty: { id: specialtyId }, questions: [] });
    expect(generate).not.toHaveBeenCalled();
  });

  it('ambiguidade real pede contexto curto antes de usar o modelo entre candidatas plausíveis', async () => {
    const first = await chat('estou com tontura');
    expect(first).toMatchObject({ status: 'needs_information', specialty: null, clinics: [] });
    expect(first.questions.join(' ')).toMatch(/quanto tempo|outro sintoma/i);
    expect(generate).not.toHaveBeenCalled();

    generate.mockResolvedValueOnce(suggestion('Otorrinolaringologia'));
    const result = await chat(
      'começou hoje e não tenho outros sintomas',
      ['estou com tontura'],
      first.context,
    );
    expect(result.specialty?.id).toBe('otorrinolaringologia');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        specialties: expect.arrayContaining([
          expect.objectContaining({ id: 'otorrinolaringologia' }),
          expect.objectContaining({ id: 'neurologia' }),
          expect.objectContaining({ id: 'clinica-medica' }),
        ]),
      }),
    );
  });

  it('modelo indisponível após esclarecimento curto mantém uma porta de entrada em vez de dead-end', async () => {
    const first = await chat('estou com tontura');
    generate.mockRejectedValueOnce(new Error('offline'));
    const result = await chat(
      'começou hoje e não tenho outros sintomas',
      ['estou com tontura'],
      first.context,
    );
    expect(result).toMatchObject({
      mode: 'fallback',
      specialty: { id: 'clinica-medica' },
    });
    expect(result.answer).not.toContain('Não consegui validar');
  });

  it('saúde rara sem regra lexical recebe uma tentativa semântica e fallback amplo', async () => {
    generate.mockResolvedValueOnce({ urgency: 'uncertain', specialty: null, questions: [] });
    const result = await chat('tenho uma síndrome rara e preciso saber qual médico procurar');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.specialty?.id).toBe('clinica-medica');
  });

  it('idade é pedida somente quando realmente necessária para uma queixa geral de possível criança', async () => {
    const message = 'minha filha está com febre e cansaço';
    const first = await chat(message);
    expect(first).toMatchObject({ status: 'needs_information', specialty: null });
    expect(first.questions.join(' ')).toContain('idade da sua filha');
    expect(generate).not.toHaveBeenCalled();

    const second = await chat('8 anos', [message], first.context);
    // Knowing age alone does not answer how long the fever has lasted.
    expect(second).toMatchObject({ status: 'needs_information', specialty: null });
    expect(second.context?.care?.answeredTopics).toContain('age_group');
    expect(second.questions.join(' ')).toMatch(/quanto tempo|começou/i);

    const third = await chat(
      'Começou ontem, não tenho outros sintomas.',
      [message, '8 anos'],
      second.context,
    );
    expect(third.specialty?.id).toBe('pediatria');
  });

  it('idade do cuidador não é aplicada ao paciente', async () => {
    const message = 'minha filha está com febre e cansaço';
    const first = await chat(message);
    const second = await chat('Eu tenho 35 anos.', [message], first.context);
    expect(second.specialty).toBeNull();
    expect(second.questions.join(' ')).toContain('idade da sua filha');
  });

  it('urgência interrompe qualquer esclarecimento/semântica', async () => {
    const provider = { ...demoProvider, generate: vi.fn(), embed: vi.fn() };
    const instance = await buildApp(config, db, provider);
    try {
      const response = chatResponseSchema.parse(
        (
          await instance.inject({
            method: 'POST',
            url: '/api/chat',
            payload: { message: 'estou com fala enrolada e fraqueza de um lado' },
          })
        ).json(),
      );
      expect(response).toMatchObject({ mode: 'safety', urgency: 'emergency', specialty: null });
      expect(provider.generate).not.toHaveBeenCalled();
      expect(provider.embed).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });

  it('consulta de catálogo não vira entrevista clínica', async () => {
    const result = await chat('Quais clínicas aceitam Unimed?');
    expect(result).toMatchObject({ mode: 'catalog', intent: 'clinic_search' });
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it('contrato do modelo aceita somente tópicos estruturados', () => {
    for (const value of ['Procure Oculista?', 'Tome 500mg?', 'Especialista ocular avançado'])
      expect(
        modelAnswerSchema.safeParse({
          urgency: 'uncertain',
          specialty: null,
          questions: [value],
        }).success,
      ).toBe(false);
  });
});

  it('nova queixa da mesma pessoa não herda a especialidade anterior', async () => {
    const previous = 'estou com dor no joelho desde ontem após correr, sem outros sintomas';
    const first = await chat(previous);
    expect(first.specialty?.id).toBe('ortopedia');

    const second = await chat('tenho refluxo quase todo dia', [previous], first.context);
    expect(second.specialty?.id).toBe('gastroenterologia');
    expect(second.specialty?.id).not.toBe('ortopedia');
    expect(second.questions).toEqual([]);
  });

  it('sintoma complementar com pronome e “também” continua no mesmo episódio', async () => {
    const previous = 'minha mãe está com tontura';
    const first = await chat(previous);
    const second = await chat('ela também está enjoada desde hoje', [previous], first.context);
    expect(second.intent).toBe('care_navigation');
    expect(second.context?.care?.round ?? 0).toBeGreaterThanOrEqual(0);
  });

describe('Medicina de Família permanece desativada por decisão de escopo', () => {
  it('não aparece como filtro nem relação pública', async () => {
    const meta = (await app.inject('/api/catalog')).json();
    expect(meta.specialties.some((s: { id: string }) => s.id === 'medicina-de-familia')).toBe(false);
    expect((await app.inject('/api/clinics?specialty=medicina-de-familia')).json().total).toBe(0);
  });

  it('não é fornecida ao LLM e saída inativa não é exibida', async () => {
    generate.mockResolvedValueOnce(suggestion('Medicina de Família e Comunidade'));
    const result = await chat('tenho uma síndrome rara e preciso saber qual médico procurar');
    expect(result.specialty?.id).toBe('clinica-medica');
    expect(generate.mock.calls[0][0].specialties?.some((s) => s.id === 'medicina-de-familia')).toBe(
      false,
    );
    expect(
      (await new SpecialtyRepository(db).resolve('Medicina de Família e Comunidade')).status,
    ).toBe('not_registered');
  });

  it('busca direta pela área removida pede outra opção, sem relaxar silenciosamente', async () => {
    const response = await chat('quero uma clínica de medicina de família');
    expect(response).toMatchObject({ status: 'needs_information', specialty: null, clinics: [] });
    expect(response.answer).toContain('não faz parte das opções ativas');
    expect(generate).not.toHaveBeenCalled();
  });
});
