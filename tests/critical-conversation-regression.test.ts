
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { demoProvider } from '../server/ai/demo.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { patientProfile } from '../server/domain/patient.js';
import { chatResponseSchema, type ChatContext } from '../shared/contracts.js';

const config = readConfig({
  NODE_ENV: 'test',
  DATA_DIR: 'memory://',
  CHAT_RATE_LIMIT: '120',
});

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const generate = vi.fn(demoProvider.generate);

async function send(
  message: string,
  history: string[] = [],
  context?: ChatContext | null,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/chat',
    payload: {
      message,
      history,
      ...(context ? { context } : {}),
    },
  });

  expect(response.statusCode, response.body).toBe(200);
  return chatResponseSchema.parse(response.json());
}

beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await loadPublicCatalog(db);

  app = await buildApp(config, db, {
    ...demoProvider,
    generate,
  });
});

afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Regressão crítica da entrevista contextual', () => {
  it('não encaminha automaticamente dor nas costas sem detalhes', async () => {
    const first = await send('Estou com dor nas costas');

    expect(first).toMatchObject({
      status: 'needs_information',
      specialty: null,
      clinics: [],
    });

    expect(first.context?.care?.questions).toContain(
      'associated_symptoms',
    );
  });

  it('guarda uma resposta curta e não repete sinais já negados', async () => {
    const initial = 'Estou com dor nas costas';
    const first = await send(initial);
    const second = await send('não', [initial], first.context);

    expect(second.context?.care?.answeredTopics).toContain(
      'associated_symptoms',
    );

    expect(second.context?.care?.interview).toContainEqual({
      topics: first.context!.care!.questions,
      answer: 'não',
    });

    expect(second.questions.join(' ')).not.toContain(
      'Além da dor nas costas',
    );
  });

  it.each([
    ['Tenho formigamento nas duas pernas.', 'emergency'],
    ['Tenho dormência em ambas as pernas.', 'emergency'],
    ['Tenho fraqueza nas duas pernas.', 'emergency'],
    ['Não consigo urinar.', 'emergency'],
    ['Perdi o controle da urina.', 'emergency'],
    ['Tenho febre.', 'prompt'],
    ['Tenho febre e dor no peito.', 'emergency'],
  ] as const)(
    'resposta à dor nas costas prioriza segurança: %s',
    async (reply, urgency) => {
      const initial = 'Estou com dor nas costas';
      const first = await send(initial);
      const second = await send(reply, [initial], first.context);

      expect(second).toMatchObject({
        mode: 'safety',
        urgency,
        specialty: null,
        clinics: [],
      });
    },
  );

  it('sinal grave após a primeira indicação mantém o mesmo episódio clínico', async () => {
    const previous =
      'Dor nas costas desde ontem após carregar peso, sem outros sintomas.';

    const first = await send(previous);

    expect(first.specialty?.id).toBe('ortopedia');

    const second = await send(
      'Tenho formigamento nas duas pernas.',
      [previous],
      first.context,
    );

    expect(second).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      clinics: [],
    });
  });

  it('alertas não são disparados quando negados explicitamente', async () => {
    const result = await send(
      'Dor nas costas desde ontem, sem febre e sem dormência.',
    );

    expect(result.mode).not.toBe('safety');
    expect(result.urgency).not.toBe('emergency');
  });

  it('não transforma três respostas incertas em Ortopedia só pela localização', async () => {
    const history = ['Estou com dor nas costas'];
    let result = await send(history[0]);

    for (let i = 0; i < 3; i++) {
      result = await send(
        'não sei',
        history,
        result.context,
      );

      history.push('não sei');
    }

    expect(result.specialty?.id).toBe('clinica-medica');
    expect(result.answer).toContain('Ainda faltam informações');
  });

  it('não confunde duração de sintomas com idade', () => {
    expect(
      patientProfile([
        'Tenho dor nas costas com duração de 5 anos.',
      ]).ageYears,
    ).toBeNull();

    expect(
      patientProfile([
        'Minha filha tem oito meses de sintomas.',
      ]).ageYears,
    ).toBeNull();

    expect(
      patientProfile([
        'Minha filha de oito anos está com dor.',
      ]).ageYears,
    ).toBe(8);
  });

  it('retém idade curta da criança depois de uma confirmação', async () => {
    const initial =
      'Minha filha está com febre e cansaço desde ontem.';

    const first = await send(initial);

    expect(first.context?.care?.questions).toEqual([
      'age_group',
    ]);

    const second = await send(
      '5',
      [initial],
      first.context,
    );

    expect(second.specialty?.id).toBe('pediatria');

    const third = await send(
      'Tem certeza?',
      [initial, '5'],
      second.context,
    );

    expect(third.specialty?.id).toBe('pediatria');
  });

  it('não herda Pediatria de uma pessoa anterior quando idade é desconhecida', async () => {
    const result = await send(
      'Tem certeza?',
      ['Estou com febre e cansaço.'],
      {
        specialtyId: 'pediatria',
        clinicIds: [],
        city: '',
        insurance: '',
      },
    );

    expect(result.specialty).toBeNull();

    expect(result.questions.join(' ')).toMatch(/idade/i);
  });

  it('intoxicação é mantida como emergência no turno seguinte', async () => {
    const initial =
      'Minha filha de 19 anos tomou 20 comprimidos por engano.';

    const first = await send(initial);

    expect(first.mode).toBe('safety');

    const second = await send(
      'Mas ela disse que está bem. Podemos esperar?',
      [initial],
      first.context,
    );

    expect(second).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      clinics: [],
    });
  });

  it('filtro de plano aplica-se às opções anteriores; removê-lo não amplia a seleção', async () => {
    const initial = 'Estou com dor no pé';
    const first = await send(initial);

    const detail =
      'Começou ontem após correr, sem outros sintomas.';

    const second = await send(
      detail,
      [initial],
      first.context,
    );

    expect(
      second.clinics.map((clinic) => clinic.id),
    ).toContain('public-cti');

    // Preserva as clínicas originalmente apresentadas.
    const originalIds = second.clinics.map(
      (clinic) => clinic.id,
    );

    // Primeiro filtro: CAFAZ.
    const third = await send(
      'Quais destas clínicas atendem pelo CAFAZ?',
      [initial, detail],
      second.context,
    );

    expect(
      third.clinics.map((clinic) => clinic.id),
    ).toEqual(['public-cti']);

    // A memória deve manter a seleção original.
    expect(
      third.context?.catalog?.selectionIds,
    ).toEqual(originalIds);

    // O último resultado filtrado contém somente a CTI.
    expect(
      third.context?.catalog?.resultIds,
    ).toEqual(['public-cti']);

    // Remove o filtro de convênio.
    const fourth = await send(
      'Dessas clínicas, pesquise sem filtro de convênio',
      [initial, detail],
      third.context,
    );

    // O filtro de plano deve ser limpo.
    expect(fourth.context?.insurance).toBe('');

    // A lista original não pode ser perdida.
    expect(
      fourth.context?.catalog?.selectionIds,
    ).toEqual(originalIds);

    // A remoção do filtro deve recuperar exatamente
    // as clínicas originais, sem inserir outras.
    expect(
      fourth.clinics.map((clinic) => clinic.id).sort(),
    ).toEqual([...originalIds].sort());
  });

  it('modo Ollama chama a interpretação semântica na primeira queixa', async () => {
    const semantic = vi.fn(demoProvider.generate);

    const local = await buildApp(config, db, {
      ...demoProvider,
      mode: 'ollama',
      generate: semantic,
    });

    try {
      const response = await local.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          message: 'Estou com dor na pelve.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(semantic).toHaveBeenCalledTimes(1);
      expect(response.json().specialty).toBeNull();

      expect(
        response.json().questions.length,
      ).toBeGreaterThan(0);
    } finally {
      await local.close();
    }
  });
});
