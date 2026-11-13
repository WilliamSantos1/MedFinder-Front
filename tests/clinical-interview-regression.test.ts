import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { demoProvider } from '../server/ai/demo.js';
import { createOllamaProvider } from '../server/ai/ollama.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { patientProfile } from '../server/domain/patient.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { chatResponseSchema, type ChatContext } from '../shared/contracts.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', CHAT_RATE_LIMIT: '120' });
const generate = vi.fn(demoProvider.generate);
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;

async function chat(message: string, history: string[] = [], context?: ChatContext | null) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { message, history, context: context ?? undefined },
  });
  expect(response.statusCode, response.body).toBe(200);
  return chatResponseSchema.parse(response.json());
}

beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await loadPublicCatalog(db);
  app = await buildApp(config, db, { ...demoProvider, generate });
});
beforeEach(() => {
  generate.mockReset().mockImplementation(demoProvider.generate);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Entrevista contextual e validação independente do modelo', () => {
  it('preserva o significado de não ao avançar para outras perguntas', async () => {
    const initial = 'bom dia, estou com uma dor nas costas, o que fazer?';
    const first = await chat(initial);
    const second = await chat('não', [initial], first.context);
    expect(second.context?.care?.answeredTopics).toContain('associated_symptoms');
    expect(second.context?.care?.questions).not.toContain('associated_symptoms');
    expect(second.specialty).toBeNull();
    const third = await chat('Começou ontem após carregar peso.', [initial, 'não'], second.context);
    expect(third.specialty?.id).toBe('ortopedia');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].interview).toContainEqual({
      topics: first.context!.care!.questions,
      answer: 'não',
    });
  });

  it.each(['Pediatria', 'Cirurgia Pediátrica', 'Endocrinologia e Metabologia', 'Área inexistente'])(
    'rejeita uma especialidade incompatível devolvida pela IA: %s',
    async (name) => {
      const initial = 'estou com dor no ombro';
      const first = await chat(initial);
      generate.mockResolvedValueOnce({ urgency: 'routine', specialty: { name }, questions: [] });
      const second = await chat(
        'Começou ontem depois da academia e não tenho outros sintomas.',
        [initial],
        first.context,
      );
      // Quando mecanismo + evolução já sustentam Ortopedia, um retorno
      // impossível do Qwen não deve apagar a especialidade válida.
      expect(second.specialty?.id).toBe('ortopedia');
      expect(second.clinics.every((clinic) => clinic.specialties.includes('ortopedia'))).toBe(true);
      const candidates = generate.mock.calls[0][0].specialties!.map((area) => area.id);
      expect(candidates).not.toContain('pediatria');
      expect(candidates).not.toContain('cirurgia-pediatrica');
      expect(second.specialty?.reason).not.toContain('idade informada');
    },
  );

  it('respeita pergunta útil mesmo quando o modelo também devolve uma candidata', async () => {
    const initial = 'estou com dor no joelho';
    const first = await chat(initial);
    generate.mockResolvedValue({
      urgency: 'routine',
      specialty: { name: 'Ortopedia e Traumatologia' },
      questions: ['impact'],
    });
    const detail = 'Começou ontem após correr, sem outros sintomas.';
    const second = await chat(detail, [initial], first.context);
    expect(second.status).toBe('needs_information');
    expect(second.specialty).toBeNull();
    expect(second.context?.care?.questions).toEqual(['impact']);
    const third = await chat(
      'Consigo andar e trabalhar, não atrapalha minhas atividades.',
      [initial, detail],
      second.context,
    );
    expect(third.specialty?.id).toBe('ortopedia');
    expect(third.questions).toEqual([]);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('não repete uma pergunta do modelo cuja resposta já foi dada', async () => {
    const initial = 'estou com dor no pé';
    const first = await chat(initial);
    generate.mockResolvedValueOnce({
      urgency: 'routine',
      specialty: { name: 'Ortopedia' },
      questions: ['location', 'onset_duration'],
    });
    const second = await chat(
      'Começou ontem após correr, sem outros sintomas.',
      [initial],
      first.context,
    );
    expect(second.specialty?.id).toBe('ortopedia');
    expect(second.questions).toEqual([]);
  });

  it('não transforma três respostas incertas em indicação específica', async () => {
    const initial = 'Estou com dor nas costas';
    let response = await chat(initial);
    const history = [initial];
    for (let round = 0; round < 3; round++) {
      response = await chat('não sei', history, response.context);
      history.push('não sei');
    }
    expect(response.specialty?.id).toBe('clinica-medica');
    expect(response.answer).toContain('Ainda faltam informações');
    expect(response.specialty?.reason).toContain('entrada ampla');
    expect(generate).not.toHaveBeenCalled();
  });

  it('sim a uma lista pede qual sinal e preserva a dor nas costas para a segurança', async () => {
    const initial = 'Estou com dor nas costas';
    const first = await chat(initial);
    const second = await chat('sim', [initial], first.context);
    expect(second.specialty).toBeNull();
    expect(second.questions.join(' ')).toContain('Qual dos sinais');
    const third = await chat('Tenho fraqueza nas duas pernas.', [initial, 'sim'], second.context);
    expect(third).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      specialty: null,
      clinics: [],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ['Tenho formigamento nas duas pernas.', 'emergency'],
    ['Tenho dormência em ambas as pernas.', 'emergency'],
    ['Não consigo urinar.', 'emergency'],
    ['Perdi o controle da urina.', 'emergency'],
    ['Tenho febre.', 'prompt'],
    ['Tenho febre e dor no peito.', 'emergency'],
  ])('sinal associado em outro turno preserva a prioridade: %s', async (reply, urgency) => {
    const initial = 'Estou com dor nas costas';
    const first = await chat(initial);
    const response = await chat(reply, [initial], first.context);
    expect(response).toMatchObject({ mode: 'safety', urgency, specialty: null, clinics: [] });
    expect(generate).not.toHaveBeenCalled();
  });

  it('negação explícita de alerta não é convertida em emergência', async () => {
    const response = await chat(
      'Dor nas costas desde ontem após esforço, sem febre, sem dormência nas duas pernas e sem outros sintomas.',
    );
    expect(response.mode).not.toBe('safety');
    expect(response.specialty?.id).toBe('ortopedia');
  });

  it('confirmação repetidamente ambígua de sinais não termina em catálogo eletivo', async () => {
    const initial = 'Estou com dor nas costas';
    let response = await chat(initial);
    const history = [initial];
    for (let round = 0; round < 3; round++) {
      response = await chat('sim', history, response.context);
      history.push('sim');
    }
    expect(response).toMatchObject({ mode: 'safety', urgency: 'prompt', clinics: [] });
    // The response must prioritize an in-person urgent assessment, not a
    // particular sentence fragment or elective clinic recommendation.
    expect(response.answer).toContain('avaliação presencial');
    expect(response.answer).toContain('Não aguarde uma consulta eletiva');
    expect(generate).not.toHaveBeenCalled();
  });

  it('consulta de convênio no meio da entrevista não responde perguntas clínicas', async () => {
    const initial = 'Estou com dor no joelho';
    const first = await chat(initial);
    const catalog = await chat('Quais clínicas aceitam Unimed?', [initial], first.context);
    expect(catalog.intent).toBe('clinic_search');
    expect(catalog.context?.care).toEqual(first.context?.care);
    const final = await chat(
      'Começou ontem após correr, sem outros sintomas.',
      [initial, 'Quais clínicas aceitam Unimed?'],
      catalog.context,
    );
    expect(final.specialty?.id).toBe('ortopedia');
    expect(final.context?.insurance).toBe('Unimed');
    expect(final.clinics.every((clinic) => clinic.insurances.includes('Unimed'))).toBe(true);
  });

  it.each([
    ['Estou com febre e cansaço.', null],
    ['Tenho 35 anos, febre e cansaço.', 'clinica-medica'],
  ])('confirmação não perpetua Pediatria antiga: %s', async (initial, expected) => {
    const response = await chat('Tem certeza?', [initial], {
      specialtyId: 'pediatria',
      clinicIds: [],
      city: '',
      insurance: '',
    });
    expect(response.specialty?.id ?? null).toBe(expected);
    if (expected === null) expect(response.context?.care?.questions).toEqual(['age_group']);
    expect(response.answer).not.toContain('Pediatria continua');
  });

  it('catálogo pediátrico explícito continua disponível sem exigir idade', async () => {
    const response = await chat('Quais clínicas de Pediatria?');
    expect(response.mode).toBe('catalog');
    expect(response.specialty?.id).toBe('pediatria');
    expect(response.clinics.length).toBeGreaterThan(0);
  });

  it('idade curta respondida à pergunta permanece associada à mesma pessoa', async () => {
    const initial = 'Minha filha está com febre e cansaço desde ontem.';
    const first = await chat(initial);
    const second = await chat('5', [initial], first.context);
    expect(second.specialty?.id).toBe('pediatria');
    expect(second.context?.care?.questions).toEqual([]);
    const third = await chat('Tem certeza?', [initial, '5'], second.context);
    expect(third.specialty?.id).toBe('pediatria');
    expect(third.questions).toEqual([]);
    const fourth = await chat(
      'Ela continua com os mesmos sintomas.',
      [initial, '5', 'Tem certeza?'],
      third.context,
    );
    expect(fourth.specialty?.id).toBe('pediatria');
    expect(fourth.questions).toEqual([]);
  });

  it('valida a resposta errada usando o adaptador Ollama e JSON reais, com HTTP simulado', async () => {
    const local = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', AI_PROVIDER: 'ollama' });
    const transport = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/show')
              ? { details: { format: 'gguf' }, capabilities: ['completion', 'embedding'] }
              : {
                  done: true,
                  done_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: JSON.stringify({
                      urgency: 'routine',
                      specialty: { name: 'Pediatria' },
                      questions: [],
                    }),
                  },
                },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const realAdapter = createOllamaProvider(local, transport);
    const embed = vi.fn(async () => {
      throw new Error('Embedding indisponível');
    });
    const localApp = await buildApp(local, db, {
      ...realAdapter,
      embed,
    });
    try {
      const response = await localApp.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          message: 'Começou ontem após carregar peso, sem outros sintomas.',
          history: ['Bom dia, estou com dor nas costas, o que fazer?'],
          context: {
            specialtyId: null,
            clinicIds: [],
            city: '',
            insurance: '',
            care: {
              questions: ['onset_duration', 'associated_symptoms'],
              askedTopics: ['onset_duration', 'associated_symptoms'],
              round: 1,
            },
          },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const result = chatResponseSchema.parse(response.json());
      expect(result.mode).toBe('ollama');
      expect(result.specialty?.id).toBe('clinica-medica');
      expect(result.ragStatus).toBe('not_indexed');
      expect(embed).not.toHaveBeenCalled();
      const [, init] = transport.mock.calls.find(([url]) => String(url).endsWith('/chat'))!;
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages[1].content);
      expect(input.reportedPatient.ageYears).toBeNull();
      expect(input.candidateSpecialties.some((s: { id: string }) => s.id === 'pediatria')).toBe(
        false,
      );
    } finally {
      await localApp.close();
    }
  });
});

describe('Idade não é duração de sintomas', () => {
  it.each([
    ['Tenho dor nas costas com duração de 5 anos.', null],
    ['Tenho cinco anos de dor nas costas.', null],
    ['Minha filha tem oito meses de sintomas.', null],
    ['Minha filha tem uma dor com duração de 8 meses.', null],
    ['Minha filha sente dor por mais de 5 anos.', null],
    ['Estou com dor nos últimos 3 anos.', null],
    ['Minha filha está com dor há 8 anos.', null],
    ['Dor nas costas durante cinco anos.', null],
    ['Minha filha de oito anos está com dor.', 8],
    ['Tenho vinte e cinco anos e dor há dois anos.', 25],
    ['Meu bebê tem 20 dias de vida.', 20 / 365],
    ['Minha filha está com dor', null],
  ])('%s', (message, expected) => {
    expect(patientProfile([message]).ageYears).toBe(expected);
  });
});
