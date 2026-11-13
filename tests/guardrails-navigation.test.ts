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

import { demoProvider } from '../server/ai/demo.js';

import { readConfig } from '../server/config.js';

import {
  connectDatabase,
  type Database,
} from '../server/db/database.js';

import { migrate } from '../server/db/migrations.js';

import { loadPublicCatalog } from '../server/services/public-catalog.js';

import {
  chatResponseSchema,
  type ChatContext,
} from '../shared/contracts.js';

const config =
  readConfig({
    NODE_ENV: 'test',

    DATA_DIR:
      'memory://',

    CHAT_RATE_LIMIT:
      '120',
  });

let db: Database;

let app: Awaited<
  ReturnType<
    typeof buildApp
  >
>;

const generate =
  vi.fn(
    demoProvider.generate,
  );

const embed =
  vi.fn(
    demoProvider.embed,
  );

async function chat(
  message: string,

  history: string[] = [],

  context?:
    | ChatContext
    | null,
) {
  const response =
    await app.inject({
      method: 'POST',

      url: '/api/chat',

      payload: {
        message,

        history,

        context:
          context ??
          undefined,
      },
    });

  expect(
    response.statusCode,
  ).toBe(200);

  return chatResponseSchema.parse(
    response.json(),
  );
}

beforeAll(async () => {
  db =
    await connectDatabase(
      config,
    );

  await migrate(db);

  await loadPublicCatalog(
    db,
  );

  app = await buildApp(
    config,

    db,

    {
      ...demoProvider,

      generate,

      embed,
    },
  );
});

beforeEach(() => {
  generate
    .mockReset()
    .mockImplementation(
      demoProvider.generate,
    );

  embed.mockClear();
});

afterAll(async () => {
  await app?.close();

  await db?.close();
});

describe(
  'Guardrails e continuidade conversacional',
  () => {
    it(
      'não reutiliza Oftalmologia para pedido de automedicação e não chama IA/RAG',
      async () => {
        const context: ChatContext =
          {
            specialtyId:
              'oftalmologia',

            clinicIds: [
              'public-cldo-aldeota',
            ],

            city:
              'Fortaleza',

            insurance: '',
          };

        const response =
          await chat(
            'vou tomar rivotril, pode ser?',

            [],

            context,
          );

        expect(
          response,
        ).toMatchObject({
          mode: 'safety',

          specialty: null,

          clinics: [],

          ragStatus:
            'skipped',
        });

        expect(
          response.answer,
        ).toMatch(
          /não recomenda.*confirma.*prescreve/i,
        );

        expect(
          response.answer,
        ).toMatch(
          /não tome.*dê.*aplique.*use medicamentos/i,
        );

        expect(
          generate,
        ).not.toHaveBeenCalled();

        expect(
          embed,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      'qual remédio eu devo tomar?',

      'qual dose de ibuprofeno devo usar?',

      'posso usar amoxicilina?',

      'me receita um antibiótico',

      'Rivotril ajuda?',

      'estou pensando em dar uma dipirona para ele, o que acha?',

      'aquela tontura que comentei, a dipirona resolveria?',

      'posso dar Dorflex para minha mãe?',

      'já tomei paracetamol e ainda estou com dor',

      'meu médico receitou amoxicilina; posso aumentar a dose?',

      'lisinopril é seguro para isso?',

      'dipirona tem contraindicação?',
    ])(
      'intercepta orientação de medicamento: %s',

      async (message) => {
        const response =
          await chat(
            message,
          );

        expect(
          response.mode,
        ).toBe(
          'safety',
        );

        expect(
          response.specialty,
        ).toBeNull();

        expect(
          response.clinics,
        ).toEqual([]);

        expect(
          response.answer,
        ).toMatch(
          /MedFinder não recomenda.*medicamento|MedFinder não recomenda.*prescreve/i,
        );

        expect(
          generate,
        ).not.toHaveBeenCalled();

        expect(
          embed,
        ).not.toHaveBeenCalled();
      },
    );

  it.each([
    'eu posso ministrar pra ela dipirona enquanto nao chega la?',
    'Pode administrar um comprimido de paracetamol para ele?',
    'É seguro medicar meu filho com ibuprofeno?',
  ])('bloqueia novas flexões de administração: %s', async (message) => {
    const response = await chat(message);
    expect(response.mode).toBe('safety');
    expect(response.clinics).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('relato de uso habitual não impede avaliação de outro sintoma', async () => {
    const response = await chat('Meu avô costuma tomar remédio para o coração e está tonto.');
    expect(response.mode).not.toBe('safety');
    expect(response.intent).toBe('care_navigation');
  });

  it('alerta de muitos comprimidos persiste em uma pergunta seguinte da mesma pessoa', async () => {
    const firstMessage = 'Minha filha de 19 anos tomou 20 comprimidos por engano.';
    const first = await chat(firstMessage);
    expect(first).toMatchObject({ mode: 'safety', urgency: 'emergency' });
    const next = await chat('Ela está bem, posso esperar até amanhã?', [firstMessage]);
    expect(next).toMatchObject({ mode: 'safety', urgency: 'emergency' });
  });

    it(
      'não aceita produto tóxico como tratamento e orienta intoxicação sem chamar IA',
      async () => {
        const response =
          await chat(
            'posso beber água sanitária para melhorar?',
          );

        expect(
          response,
        ).toMatchObject({
          mode: 'safety',

          specialty: null,

          clinics: [],
        });

        expect(
          response.answer,
        ).toContain(
          '0800 722 6001',
        );

        expect(
          generate,
        ).not.toHaveBeenCalled();

        expect(
          embed,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'possível excesso de medicamento orienta Disque-Intoxicação e SAMU sem esperar IA',
      async () => {
        const response =
          await chat(
            'tomei 20 comprimidos de Rivotril por engano',
          );

        expect(
          response,
        ).toMatchObject({
          mode: 'safety',

          urgency:
            'emergency',

          clinics: [],
        });

        expect(
          response.answer,
        ).toContain(
          '0800 722 6001',
        );

        expect(
          response.sources.map(
            (source) =>
              source.id,
          ),
        ).toEqual(
          expect.arrayContaining([
            'anvisa-disque-intoxicacao',

            'samu-192',
          ]),
        );

        expect(
          generate,
        ).not.toHaveBeenCalled();

        expect(
          embed,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      '“tem certeza?” reaproveita a especialidade validada sem repetir cards, IA ou RAG',
      async () => {
        const context: ChatContext =
          {
            specialtyId:
              'oftalmologia',

            clinicIds: [
              'public-cldo-aldeota',
            ],

            city:
              'Fortaleza',

            insurance: '',
          };

        const response =
          await chat(
            'tem certeza?',

            [
              'Meu olho está coçando e avermelhado.',
            ],

            context,
          );

        expect(
          response,
        ).toMatchObject({
          status: 'ok',

          specialty: {
            id:
              'oftalmologia',
          },

          clinics: [],

          sources: [],

          ragStatus:
            'skipped',
        });

        expect(
          response.answer,
        ).toContain(
          'Oftalmologia',
        );

        expect(
          response.answer,
        ).toMatch(
          /não confirma|avaliação/i,
        );

        expect(
          generate,
        ).not.toHaveBeenCalled();

        expect(
          embed,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      'resposta a esclarecimento não é confundida com Clínica São Carlos/Pneumologia',
      async () => {
        const firstMessage =
          'estou sentindo uma coceira no olho e ele está avermelhado';

        const first =
          await chat(
            firstMessage,
          );

        if (
          first.status ===
          'needs_information'
        ) {
          const second =
            await chat(
              'começou hoje, início de repente, do nada, os sintomas são esses que já informei',

              [
                firstMessage,
              ],

              first.context,
            );

          expect(
            second.mode,
          ).not.toBe(
            'catalog',
          );

          expect(
            second.intent,
          ).toBe(
            'care_navigation',
          );

          expect(
            second.specialty
              ?.id,
          ).not.toBe(
            'pneumologia',
          );

          expect(
            second.clinics.some(
              (clinic) =>
                clinic.specialties.includes(
                  'pneumologia',
                ),
            ),
          ).toBe(false);
        }
      },
    );

    it(
      'nova pessoa: filho de 8 anos com coriza não herda especialidade ocular anterior',
      async () => {
        const oldContext: ChatContext =
          {
            specialtyId:
              'oftalmologia',

            clinicIds: [
              'public-cldo-aldeota',
            ],

            city:
              'Fortaleza',

            insurance: '',
          };

        const response =
          await chat(
            'meu filho de 8 anos está com coriza. onde levá-lo?',

            [
              'Meu olho estava coçando e avermelhado.',
            ],

            oldContext,
          );

        expect(
          response.mode,
        ).not.toBe(
          'catalog',
        );

        expect(
          response.specialty
            ?.id,
        ).not.toBe(
          'oftalmologia',
        );

        if (
          response.specialty
        )
          expect([
            'pediatria',

            'otorrinolaringologia',
          ]).toContain(
            response.specialty
              .id,
          );

        expect(
          response.questions.join(
            ' ',
          ),
        ).not.toContain(
          'qual é a idade',
        );

        expect(
          response.questions.join(
            ' ',
          ),
        ).not.toMatch(
          /qual parte do corpo/i,
        );
      },
    );

    it(
      'não trata água, banho ou localização como medicamento',
      async () => {
        const harmlessMessages = [
          'posso tomar água?',

          'vou tomar banho',

          'vou usar minha localização',
        ];

        for (
          const message of
          harmlessMessages
        ) {
          const response =
            await chat(
              message,
            );

          expect(
            response.answer,
          ).not.toMatch(
            /atenção sobre medicamentos/i,
          );
        }
      },
    );
  },
);