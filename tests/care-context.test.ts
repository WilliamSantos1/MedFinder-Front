import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { demoProvider } from '../server/ai/demo.js';
import { patientProfile } from '../server/domain/patient.js';
import { careInput } from '../server/ai/prompt.js';
import { chatResponseSchema, type ChatContext } from '../shared/contracts.js';
import { suggestion } from './fixtures.js';

const screenshotMessage =
  'meu ouvido está doente muito, começou a 3 dias, começou a coçar depois que usei um lapis para coçar, onde eu devo ir?';
const daughterMessage = 'Minha filha está com coceira na pele, com manchas vermelhas desde ontem.';
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
  // Deterministic adapter with production presentation; no real model weights are used.
  app = await buildApp(config, db, { ...demoProvider, mode: 'ollama', generate, embed });
});
beforeEach(() => {
  generate.mockReset().mockImplementation(demoProvider.generate);
  embed.mockClear();
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Regressão do questionário obrigatório', () => {
  it('reproduz exatamente a foto: área relacionada, explicação e prioridade presencial sem perguntas ou clínicas eletivas', async () => {
    const response = await chat(screenshotMessage);
    expect(response).toMatchObject({
      mode: 'safety',
      urgency: 'prompt',
      specialty: { id: 'otorrinolaringologia' },
      questions: [],
      clinics: [],
      ragStatus: 'skipped',
    });
    expect(response.answer).toContain('irritação ou lesão');
    expect(response.answer).toContain('ainda hoje');
    expect(response.answer).not.toMatch(/você tem|é uma otite|não é grave/i);
    expect(response.sources.some((source) => source.publisher === 'NHS')).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });
  it('não repete perguntas quando já existe candidata válida e contexto, mesmo com incerteza diagnóstica', async () => {
    generate.mockResolvedValueOnce({
      ...suggestion('Otorrino'),
      urgency: 'uncertain',
      questions: ['trigger', 'associated_symptoms'],
    });
    const result = await chat('Meu ouvido está coçando há três dias, começou depois que nadei.');
    expect(result).toMatchObject({
      specialty: { id: 'otorrinolaringologia' },
      questions: [],
      urgency: 'uncertain',
    });
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(result.answer).toContain('diferentes causas');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('não exige duração se outro detalhe já permite ao modelo orientar uma área', async () => {
    generate.mockResolvedValueOnce(suggestion('Ortopedia'));
    const result = await chat('O pescoço dói quando viro e a dor se espalha para o ombro.');
    expect(result).toMatchObject({ specialty: { id: 'ortopedia' }, questions: [] });
  });
  it('não transforma descrição longa não reconhecida por regex em formulário obrigatório', async () => {
    generate.mockResolvedValueOnce(suggestion('Otorrinolaringologia'));
    const result = await chat(
      'Minha garganta fica arranhando e minha voz fica rouca quando passo bastante tempo falando no trabalho, com sensação de secura.',
    );
    expect(result).toMatchObject({ specialty: { id: 'otorrinolaringologia' }, questions: [] });
  });
  it('não completa automaticamente uma lista de perguntas quando o modelo não consegue orientar', async () => {
    generate.mockResolvedValueOnce({
      ...suggestion(),
      specialty: null,
      urgency: 'uncertain',
      questions: ['trigger'],
    });
    const result = await chat('Meu ouvido coça depois que nado.');
    expect(result).toMatchObject({ specialty: null, questions: [] });
    expect(result.answer).toContain('avaliação presencial');
  });
  it('menção negada a lápis não aciona o fluxo de lesão', async () => {
    generate.mockResolvedValueOnce(suggestion('Otorrinolaringologia'));
    const result = await chat('Meu ouvido coça depois de nadar, não usei lápis.');
    expect(result.mode).toBe('ollama');
    expect(generate).toHaveBeenCalledOnce();
  });
  it('uso de lápis sem relação com o ouvido não aciona o fluxo de lesão', async () => {
    generate.mockResolvedValueOnce(suggestion('Otorrinolaringologia'));
    const result = await chat(
      'Meu ouvido coça depois de nadar. Usei um lápis para desenhar ontem.',
    );
    expect(result.mode).toBe('ollama');
    expect(generate).toHaveBeenCalledOnce();
  });
  it('descrição usa texto controlado e não publica diagnóstico ou áreas extras do modelo', async () => {
    generate.mockResolvedValueOnce({
      ...suggestion('Dermatologia'),
      answer: 'Especialista cutâneo avançado. Causa confirmada: doença inventada.',
      specialty: { name: 'Dermatologia', reason: 'Procure Neurologia também.' },
    });
    const result = await chat('Tenho coceira na pele desde ontem, com manchas vermelhas.');
    expect(result.answer).toContain('podem estar relacionadas');
    expect(JSON.stringify(result)).not.toMatch(
      /Especialista cutâneo avançado|doença inventada|Procure Neurologia/,
    );
    expect(result.sources.some((source) => source.id === 'care-itching')).toBe(true);
  });
});

describe('Idade de quem apresenta o sintoma', () => {
  it('pergunta só idade para relato detalhado sobre filha, sem assumir que é menor', async () => {
    generate.mockResolvedValueOnce({
      ...suggestion('Dermatologia'),
      questions: ['age_group', 'impact'],
    });
    const response = await chat(daughterMessage);
    expect(response).toMatchObject({
      specialty: null,
      clinics: [],
      status: 'needs_information',
      context: { care: { questions: ['age_group'] } },
    });
    expect(response.questions).toEqual([
      'Qual é a idade da sua filha? Informe em anos ou, se for bebê, em meses.',
    ]);
    expect(embed).not.toHaveBeenCalled();
  });
  it.each([
    ['5', 'pediatria', 5],
    ['Ela tem cinco anos.', 'pediatria', 5],
    ['8 meses', 'pediatria', 8 / 12],
    ['Minha filha tem 25 anos.', 'dermatologia', 25],
  ])(
    'usa resposta %s e o histórico para orientar sem reiniciar perguntas',
    async (age, specialty, years) => {
      const first = await chat(daughterMessage);
      const result = await chat(age, [daughterMessage], first.context);
      expect(result).toMatchObject({ specialty: { id: specialty }, questions: [] });
      expect(generate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          history: [daughterMessage],
          patient: expect.objectContaining({ ageYears: years, needsAge: false }),
        }),
      );
      expect(result.answer).toContain('pele');
      expect(result.clinics.length).toBeGreaterThan(0);
      expect(result.clinics.every((clinic) => clinic.specialties.includes(specialty))).toBe(true);
    },
  );
  it('idade informada no primeiro relato não é perguntada novamente', async () => {
    const result = await chat(
      'Minha filha de 5 anos está com coceira na pele e manchas desde ontem.',
    );
    expect(result).toMatchObject({ specialty: { id: 'pediatria' }, questions: [] });
  });
  it('não aplica a idade da mãe à filha, nem na resposta seguinte', async () => {
    const message = `Tenho 35 anos. ${daughterMessage}`;
    const first = await chat(message);
    expect(first.context?.care?.questions).toEqual(['age_group']);
    const second = await chat('Eu tenho 35 anos.', [message], first.context);
    expect(second.specialty).toBeNull();
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patient: expect.objectContaining({ ageYears: null, needsAge: true }),
      }),
    );
  });
  it('filha explicitamente adulta não depende de idade exata', async () => {
    const result = await chat('Minha filha adulta está com coceira na pele e manchas desde ontem.');
    expect(result).toMatchObject({ specialty: { id: 'dermatologia' }, questions: [] });
  });
  it('não força Pediatria para toda criança quando a candidata é outra área válida', async () => {
    generate.mockResolvedValueOnce(suggestion('Oftalmologia'));
    const result = await chat(
      'Meu filho de 8 anos sente ardência nos olhos depois de ler, desde ontem.',
    );
    expect(result).toMatchObject({ specialty: { id: 'oftalmologia' }, questions: [] });
  });
  it('rejeita Pediatria para filha adulta em vez de ignorar a idade', async () => {
    generate.mockResolvedValueOnce(suggestion('Pediatria'));
    const result = await chat('Minha filha de 30 anos está com coceira e manchas na pele.');
    expect(result).toMatchObject({ specialty: null, status: 'invalid_output', clinics: [] });
  });
  it('trocar a pessoa impede herdar idade da conversa anterior', async () => {
    const first = await chat('Minha filha de 25 anos está com coceira e manchas na pele.');
    const result = await chat(
      'Agora meu filho está com coceira e manchas na pele.',
      ['Minha filha de 25 anos está com coceira e manchas na pele.'],
      first.context,
    );
    expect(result).toMatchObject({
      specialty: null,
      context: { care: { questions: ['age_group'] } },
    });
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        history: [],
        patient: expect.objectContaining({ ageYears: null }),
      }),
    );
  });
  it('urgência tem prioridade sobre a pergunta de idade', async () => {
    const response = await chat(
      'Minha filha está com coceira e não consegue respirar, está com falta de ar.',
    );
    expect(response).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      specialty: null,
      questions: [],
      clinics: [],
    });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('Idade: duração, unidade e privacidade', () => {
  it('o limite global continua ativo e o padrão de operação permanece 120 por minuto', async () => {
    expect(readConfig({}).HTTP_RATE_LIMIT).toBe(120);
    const limited = await buildApp({ ...config, HTTP_RATE_LIMIT: 1 }, db, demoProvider);
    try {
      expect((await limited.inject('/api/health')).statusCode).toBe(200);
      expect((await limited.inject('/api/catalog')).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
  it.each([
    ['Minha filha está com coceira há 5 anos.', null],
    ['Minha filha está com coceira há oito meses.', null],
    ['Minha filha tem coceira desde os cinco anos.', null],
    ['Minha filha tem oito meses e manchas na pele.', 8 / 12],
    ['Minha filha tem vinte e cinco anos e coceira.', 25],
    ['Tenho 35 anos e minha filha de 5 anos está com coceira.', 5],
    ['Minha filha está com coceira e eu tenho 35 anos.', null],
    ['Meu bebê tem 20 dias de vida e manchas na pele.', 20 / 365],
  ])('%s → idade da pessoa certa', (message, expected) => {
    expect(patientProfile([message]).ageYears).toBe(expected);
  });
  it('perfil fornecido ao modelo não inclui dados de identificação ou localização', () => {
    const input = {
      message: 'Minha filha tem 5 anos e coceira.',
      history: [],
      patient: patientProfile(['Minha filha tem 5 anos e coceira.']),
      location: { latitude: 51, longitude: 99 },
      birthDate: '2021-10-18',
      context: { name: 'Pessoa' },
    };
    const serialized = careInput(input);
    expect(JSON.parse(serialized).reportedPatient.ageYears).toBe(5);
    expect(serialized).not.toMatch(/latitude|longitude|birthDate|2021-10-18|Pessoa/);
  });
});
