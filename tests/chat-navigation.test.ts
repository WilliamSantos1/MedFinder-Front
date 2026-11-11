
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import {
  connectDatabase,
  type Database,
} from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { demoProvider } from '../server/ai/demo.js';
import { chatResponseSchema } from '../shared/contracts.js';
import { suggestion } from './fixtures.js';

const config = readConfig({
  NODE_ENV: 'test',
  DATA_DIR: 'memory://',
  CHAT_RATE_LIMIT: '120',
});

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;

const generate = vi.fn(demoProvider.generate);
const provider = { ...demoProvider, generate };

const location = {
  latitude: -3.7321,
  longitude: -38.5151,
};

async function chat(
  message: string,
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: { message, ...extra },
  });

  expect(response.statusCode).toBe(200);

  return chatResponseSchema.parse(response.json());
}

beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await loadPublicCatalog(db);

  app = await buildApp(config, db, provider);
});

beforeEach(() => {
  generate.mockReset();
  generate.mockImplementation(demoProvider.generate);
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Especialidade canônica e fast-path local', () => {
  it.each([
    ['bom dia, meu olho esta avermelhado e coçando.', 'oftalmologia'],
    ['tenho enxaqueca', 'neurologia'],
    ['dor no joelho desde ontem depois de correr, sem outros sintomas', 'ortopedia'],
    ['tenho refluxo', 'gastroenterologia'],
  ])('%s é resolvido sem chamar o LLM', async (message, id) => {
    const result = await chat(message);

    expect(result.specialty?.id).toBe(id);
    expect(result.questions).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('normaliza alias do modelo depois de obter contexto mínimo para queixa ambígua', async () => {
    const first = await chat('estou com tontura');

    expect(first.status).toBe('needs_information');
    expect(generate).not.toHaveBeenCalled();

    generate.mockResolvedValueOnce(suggestion('Otorrino'));

    const result = await chat(
      'começou hoje e não tenho outros sintomas',
      {
        history: ['estou com tontura'],
        context: first.context,
      },
    );

    expect(result.specialty).toMatchObject({
      id: 'otorrinolaringologia',
      name: 'Otorrinolaringologia',
    });

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('pode fazer uma pergunta clínica adicional quando ela ainda muda o direcionamento', async () => {
    const first = await chat('estou com tontura');

    expect(first.status).toBe('needs_information');
    expect(first.questions.length).toBeGreaterThanOrEqual(1);

    generate.mockResolvedValueOnce({
      urgency: 'uncertain',
      specialty: null,
      questions: ['pattern'],
    });

    const second = await chat(
      'começou hoje e não tenho outros sintomas',
      {
        history: ['estou com tontura'],
        context: first.context,
      },
    );

    expect(second.status).toBe('needs_information');
    expect(second.specialty).toBeNull();
    expect(second.questions).toHaveLength(1);
    expect(second.questions[0]).toMatch(
      /tontura|girando|desequilíbrio|desmaio/i,
    );

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('não aceita especialidade ativa fora da shortlist autorizada após esclarecimento', async () => {
    const first = await chat('estou com tontura');

    generate.mockResolvedValueOnce(suggestion('Dermatologia'));

    const result = await chat(
      'começou hoje e não tenho outros sintomas',
      {
        history: ['estou com tontura'],
        context: first.context,
      },
    );

    expect(result.specialty?.id).toBe('clinica-medica');
    expect(result.specialty?.id).not.toBe('dermatologia');
  });

  it('saída inventada do modelo não vaza e recupera para porta de entrada ampla', async () => {
    const name = 'Especialista ocular avançado';

    generate.mockResolvedValueOnce(suggestion(name));

    const result = await chat(
      'tenho uma síndrome rara e preciso saber qual médico procurar',
    );

    expect(result.specialty?.id).toBe('clinica-medica');
    expect(JSON.stringify(result)).not.toContain(name);

    expect(
      (await new SpecialtyRepository(db).resolve(name)).status,
    ).toBe('unrecognized');
  });

  it('falta absoluta de localização corporal pede esclarecimento e não consome LLM', async () => {
    const result = await chat('estou com dor');

    expect(result).toMatchObject({
      status: 'needs_information',
      specialty: null,
      clinics: [],
    });

    expect(result.questions.join(' ')).toContain('parte do corpo');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('Intenções de catálogo, filtros e continuidade', () => {
  it.each([
    'qual clínica de oftalmologia está mais perto de mim?',
    'tem alguma clínica de dermatologia perto de mim?',
    'Existe clínica de urologia em Fortaleza?',
    'Me mostre opções próximas para dermatologia.',
  ])('%s não exige inferência médica', async (message) => {
    const result = await chat(message, { location });

    expect(result.intent).toBe('clinic_search');
    expect(result.mode).toBe('catalog');
    expect(result.specialty).not.toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(result.clinics.length).toBeGreaterThan(0);

    const located = result.clinics.filter(
      (clinic) => clinic.distanceKm !== null,
    );

    const unlocated = result.clinics.filter(
      (clinic) => clinic.distanceKm === null,
    );

    expect(result.clinics).toEqual([
      ...located,
      ...unlocated,
    ]);

    const distances = located.map(
      (clinic) => clinic.distanceKm!,
    );

    expect(distances).toEqual(
      [...distances].sort((a, b) => a - b),
    );
  });

  it('busca por convênio não confunde a marca com nome de clínica', async () => {
    const result = await chat(
      'quais clínicas aceitam Unimed?',
    );

    expect(result.specialty).toBeNull();
    expect(result.clinics.length).toBeGreaterThan(0);

    expect(
      result.clinics.every((clinic) =>
        clinic.insurances.includes('Unimed'),
      ),
    ).toBe(true);

    expect(result.feedback?.reasons).toContain(
      'insurance_problem',
    );
  });

  it.each([
    'Qual dessas clínicas atende pela Unimed?',
    'Qual dessas contempla o plano Unimed?',
    'Dessas clínicas, quais são credenciadas pela Unimed?',
    'Entre as opções, quais fazem parte da rede Unimed?',
    'Dentre as alternativas, quais fazem parte da rede Unimed?',
    'Entre as unidades mostradas, quais fazem parte da rede Unimed?',
    'Alguma dessas trabalha com o plano Unimed?',
    'E quais atendem Unimed?',
    'Qual atende Unimed?',
    'E a Unimed?',
    'Qual das clínicas aceita Unimed?',
  ])(
    'convênio filtra SOMENTE as clínicas apresentadas: %s',
    async (message) => {
      const context = {
        specialtyId: 'ortopedia',
        clinicIds: [
          'public-cti',
          'public-multiclinica-fortaleza',
        ],
        city: '',
        insurance: '',
      };

      const result = await chat(message, {
        context,
        history: [
          'minha esposa está com dor no joelho após correr',
        ],
      });

      expect(result.mode).toBe('catalog');
      expect(result.status).toBe('ok');
      expect(result.context?.insurance).toBe('Unimed');

      expect(
        result.clinics.map((clinic) => clinic.id),
      ).toEqual(['public-cti']);

      expect(generate).not.toHaveBeenCalled();
    },
  );

  it('nome explícito da clínica pode ser combinado com convênio sem virar nome de operadora', async () => {
    const result = await chat(
      'A Clínica CTI atende o convênio Unimed?',
    );

    expect(result.mode).toBe('catalog');

    expect(
      result.clinics.map((clinic) => clinic.id),
    ).toEqual(['public-cti']);
  });

  it('informa apenas convênios cadastrados nas clínicas mencionadas, sem inventar', async () => {
    const result = await chat(
      'Quais planos essas clínicas aceitam?',
      {
        context: {
          specialtyId: 'ortopedia',
          clinicIds: [
            'public-cti',
            'public-multiclinica-fortaleza',
          ],
          city: '',
          insurance: '',
        },
      },
    );

    expect(result.intent).toBe('clinic_information');
    expect(result.answer).toContain('Clínica CTI');
    expect(result.answer).toContain('Unimed');
    expect(result.answer).toContain(
      'convênios não informados',
    );
  });

  it('sem contexto, "dessas clínicas" pede esclarecimento em vez de buscar toda a rede', async () => {
    const result = await chat(
      'Qual dessas clínicas atende pela Unimed?',
    );

    expect(result.status).toBe('needs_information');
    expect(result.clinics).toEqual([]);
  });

  it('aceita alias inequívoco de plano sem relaxar o filtro', async () => {
    const result = await chat(
      'quais clínicas aceitam Bradesco?',
    );

    expect(result.mode).toBe('catalog');
    expect(result.context?.insurance).toBe(
      'Bradesco Saúde',
    );

    expect(
      result.clinics.every((clinic) =>
        clinic.insurances.includes('Bradesco Saúde'),
      ),
    ).toBe(true);
  });

  it('convênio desconhecido pede correção em vez de mostrar lista sem filtro', async () => {
    expect(
      await chat(
        'quais clínicas aceitam Plano Inventado?',
      ),
    ).toMatchObject({
      status: 'needs_information',
      clinics: [],
    });
  });

  it('pergunta clínica sobre especialidade não é confundida com busca de catálogo', async () => {
    const previous =
      'estou com dor no joelho desde ontem após correr, sem outros sintomas';

    const first = await chat(previous);

    const reflux = await chat(
      'tenho refluxo quase todo dia',
      {
        history: [previous],
        context: first.context,
      },
    );

    expect(reflux.specialty?.id).toBe('gastroenterologia');

    const question = await chat(
      'refluxo seria ortopedia?',
      {
        history: [
          previous,
          'tenho refluxo quase todo dia',
        ],
        context: reflux.context,
      },
    );

    expect(question.intent).toBe('care_navigation');
    expect(question.mode).not.toBe('catalog');
    expect(question.specialty?.id).toBe(
      'gastroenterologia',
    );
  });

  it('retoma um foco clínico anterior quando o usuário faz referência explícita a ele', async () => {
    const knee =
      'estou com dor no joelho desde ontem após correr, sem outros sintomas';

    const first = await chat(knee);

    const reflux = await chat(
      'tenho refluxo quase todo dia',
      {
        history: [knee],
        context: first.context,
      },
    );

    expect(reflux.specialty?.id).toBe('gastroenterologia');

    const revisit = await chat(
      'aquela dor no joelho voltou',
      {
        history: [
          knee,
          'tenho refluxo quase todo dia',
        ],
        context: reflux.context,
      },
    );

    expect(revisit.intent).toBe('care_navigation');
    expect(revisit.specialty?.id).toBe('ortopedia');
    expect(revisit.questions).toEqual([]);
  });

  it('pedido explícito de clínica continua sendo catálogo mesmo quando cita sintoma', async () => {
    const result = await chat(
      'quais clínicas de ortopedia atendem dor no joelho?',
    );

    expect(result.intent).toBe('clinic_search');
    expect(result.mode).toBe('catalog');
    expect(result.specialty?.id).toBe('ortopedia');
  });

  it('responde informação de uma clínica pelo banco, sem LLM', async () => {
    for (const message of [
      'onde fica a Clínica CTI?',
      'A Clínica CTI atende qual especialidade?',
    ]) {
      const result = await chat(message);

      expect(result.intent).toBe(
        'clinic_information',
      );

      expect(
        result.clinics.map((clinic) => clinic.id),
      ).toEqual(['public-cti']);

      expect(result.answer).toContain(
        'Rua Júlio Lima, 675',
      );

      expect(
        result.clinics[0].specialtyDetails,
      ).toContainEqual({
        id: 'ortopedia',
        name: 'Ortopedia e Traumatologia',
      });
    }

    expect(generate).not.toHaveBeenCalled();
  });

  it('refina por contexto e ordena somente as clínicas já apresentadas', async () => {
    const eye = await chat(
      'meu olho está vermelho e coçando',
    );

    const nearby = await chat(
      'qual dessas fica mais perto de mim?',
      {
        context: eye.context,
        history: [
          'meu olho está vermelho e coçando',
        ],
        location,
      },
    );

    expect(nearby.specialty?.id).toBe('oftalmologia');

    expect(
      nearby.clinics.every((clinic) =>
        eye.context?.clinicIds.includes(clinic.id),
      ),
    ).toBe(true);

    expect(generate).not.toHaveBeenCalled();
  });

  it('cidade selecionada permanece filtro exato; sem localização não inventa distância', async () => {
    const result = await chat(
      'qual clínica de oftalmologia fica mais perto?',
      {
        city: 'Eusébio',
        location,
      },
    );

    expect(result.clinics.length).toBeGreaterThan(0);

    expect(
      result.clinics.every(
        (clinic) => clinic.city === 'Eusébio',
      ),
    ).toBe(true);

    const noLocation = await chat(
      'qual clínica de oftalmologia fica mais perto?',
    );

    expect(noLocation.locationUsed).toBe(false);

    expect(noLocation.questions.join(' ')).toContain(
      'Usar minha localização',
    );

    expect(
      noLocation.clinics.every(
        (clinic) => clinic.distanceKm === null,
      ),
    ).toBe(true);
  });

  it('urgência vence catálogo, filtros, localização e contexto', async () => {
    const response = await chat(
      'qual clínica de cardiologia fica mais perto? Estou com dor forte no peito',
      { location },
    );

    expect(response).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      specialty: null,
      clinics: [],
      context: null,
    });

    expect(generate).not.toHaveBeenCalled();
  });

  it('múltiplas especialidades explícitas exigem escolha', async () => {
    expect(
      await chat(
        'quero uma clínica de ortopedia e dermatologia',
      ),
    ).toMatchObject({
      status: 'needs_information',
      specialty: null,
      clinics: [],
    });
  });

  it('catálogo funciona em modo OpenAI sem consentimento porque não envia relato ao provedor', async () => {
    const external = {
      ...provider,
      mode: 'openai' as const,
      generate: vi.fn(),
      embed: vi.fn(),
    };

    const instance = await buildApp(
      config,
      db,
      external,
    );

    try {
      const result = await instance.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          message: 'onde fica a Clínica CTI?',
        },
      });

      expect(result.statusCode).toBe(200);
      expect(result.json().mode).toBe('catalog');
      expect(
        external.generate,
      ).not.toHaveBeenCalled();

      expect(
        external.embed,
      ).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });
});
