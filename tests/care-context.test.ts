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

const screenshotMessage =
  'meu ouvido está doente muito, começou a 3 dias, começou a coçar depois que usei um lapis para coçar, onde eu devo ir?';
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

describe('Contexto clínico controlado pelo backend', () => {
  it('objeto introduzido no ouvido prioriza avaliação presencial hoje, sem catálogo eletivo', async () => {
    const response = await chat(screenshotMessage);
    expect(response).toMatchObject({
      mode: 'safety',
      urgency: 'prompt',
      specialty: { id: 'otorrinolaringologia' },
      questions: [],
      clinics: [],
      ragStatus: 'skipped',
    });
    expect(response.answer).toContain('ainda hoje');
    expect(response.answer).not.toMatch(/você tem|é uma otite|não é grave/i);
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it('queixa clara de ouvido usa Otorrinolaringologia sem questionário ou LLM', async () => {
    const result = await chat('Meu ouvido está coçando há três dias, começou depois que nadei.');
    expect(result).toMatchObject({ specialty: { id: 'otorrinolaringologia' }, questions: [] });
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it('menção negada a lápis não aciona urgência por corpo estranho', async () => {
    const result = await chat('Meu ouvido coça depois de nadar, não usei lápis.');
    expect(result.mode).toBe('ollama');
    expect(result.specialty?.id).toBe('otorrinolaringologia');
    expect(generate).not.toHaveBeenCalled();
  });

  it('uso de lápis sem relação com o ouvido não aciona fluxo de lesão', async () => {
    const result = await chat('Meu ouvido coça depois de nadar. Usei um lápis para desenhar ontem.');
    expect(result.mode).toBe('ollama');
    expect(result.specialty?.id).toBe('otorrinolaringologia');
  });

  it('texto exibido é controlado pelo backend e não diagnostica', async () => {
    const result = await chat('Tenho coceira na pele desde ontem, com manchas vermelhas.');
    expect(result.specialty?.id).toBe('dermatologia');
    expect(result.answer).toContain('podem estar relacionadas');
    expect(result.answer).not.toMatch(/você tem|diagnóstico confirmado|pode ficar tranquilo/i);
  });
});

describe('Idade de quem apresenta o sintoma', () => {
  it('queixa geral sobre filha pede só a idade quando ela não foi informada', async () => {
    const message = 'Minha filha está com febre e cansaço desde ontem.';
    const response = await chat(message);
    expect(response).toMatchObject({
      specialty: null,
      clinics: [],
      status: 'needs_information',
      context: { care: { questions: ['age_group'] } },
    });
    expect(response.questions).toEqual([
      'Qual é a idade da sua filha? Informe em anos ou, se for bebê, em meses.',
    ]);
    expect(generate).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it.each([
    ['5', 5],
    ['Ela tem cinco anos.', 5],
    ['8 meses', 8 / 12],
  ])('resposta de idade %s leva a Pediatria para queixa geral infantil', async (age, years) => {
    const message = 'Minha filha está com febre e cansaço desde ontem.';
    const first = await chat(message);
    const result = await chat(age, [message], first.context);
    expect(result).toMatchObject({ specialty: { id: 'pediatria' }, questions: [] });
    expect(patientProfile([message, age], true).ageYears).toBeCloseTo(years);
  });

  it('queixa de órgão específico pode ir à área correspondente sem assumir que filho/filha é menor', async () => {
    const result = await chat('Minha filha está com olho vermelho e coçando desde ontem.');
    expect(result.specialty?.id).toBe('oftalmologia');
    expect(result.questions).toEqual([]);
  });

  it('idade informada no primeiro relato permite Pediatria para sintomas gerais de criança', async () => {
    const result = await chat('Meu filho de 8 anos está com coriza desde ontem à noite.');
    expect(result).toMatchObject({ specialty: { id: 'pediatria' }, questions: [] });
  });

  it('filha explicitamente adulta com queixa de pele vai para Dermatologia', async () => {
    const result = await chat('Minha filha adulta está com coceira na pele e manchas desde ontem.');
    expect(result).toMatchObject({ specialty: { id: 'dermatologia' }, questions: [] });
  });

  it('não aplica a idade do cuidador à filha', async () => {
    const message = 'Tenho 35 anos. Minha filha está com febre e cansaço.';
    const first = await chat(message);
    expect(first.context?.care?.questions).toEqual(['age_group']);
    const second = await chat('Eu tenho 35 anos.', [message], first.context);
    expect(second.specialty).toBeNull();
    expect(second.context?.care?.questions).toEqual(['age_group']);
    expect(second.questions.join(' ')).toContain('idade da sua filha');
    expect(generate).not.toHaveBeenCalled();
  });

  it('trocar a pessoa impede herdar a idade anterior', async () => {
    const previous = 'Minha filha de 25 anos está com febre e cansaço.';
    const first = await chat(previous);
    const result = await chat(
      'Agora meu filho está com febre e cansaço.',
      [previous],
      first.context,
    );
    expect(result).toMatchObject({ specialty: null, context: { care: { questions: ['age_group'] } } });
    expect(result.questions.join(' ')).toContain('idade do seu filho');
  });

  it('urgência tem prioridade sobre a pergunta de idade', async () => {
    const response = await chat('Minha filha está com coceira e não consegue respirar.');
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
  it('o limite global continua 120 por minuto', async () => {
    expect(readConfig({}).HTTP_RATE_LIMIT).toBe(120);
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

  it('perfil fornecido ao modelo não inclui localização, nascimento ou nome', () => {
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

describe('Troca de pessoa e isolamento de episódio clínico', () => {
  it('eu → avô: não herda Oftalmologia nem o texto ocular anterior', async () => {
    const firstMessage = 'Bom dia, meu olho está vermelho e coçando.';
    const first = await chat(firstMessage);
    expect(first.specialty?.id).toBe('oftalmologia');

    generate.mockClear();
    const second = await chat(
      'Obrigado, meu avô está com tontura desde hoje e não tem outros sintomas.',
      [firstMessage],
      first.context,
    );

    expect(second.specialty?.id).not.toBe('oftalmologia');
    expect(second.specialty?.id).toBe('neurologia');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'Obrigado, meu avô está com tontura desde hoje e não tem outros sintomas.',
        history: [],
        patient: expect.objectContaining({ relationship: 'avo' }),
      }),
    );
  });

  it('urgência antiga não contamina uma pessoa nova', async () => {
    const previous = 'Estou com dor forte no peito.';
    const emergency = await chat(previous);
    expect(emergency.urgency).toBe('emergency');

    const next = await chat(
      'Minha filha está com manchas e coceira na pele desde ontem.',
      [previous],
      emergency.context,
    );

    expect(next.mode).not.toBe('safety');
    expect(next.urgency).not.toBe('emergency');
    expect(next.specialty?.id).toBe('dermatologia');
  });

  it('sinais de urgência em mensagens separadas continuam combinando para a mesma pessoa', async () => {
    const previous = 'Estou com febre desde ontem.';
    const next = await chat('Agora estou com rigidez na nuca.', [previous]);
    expect(next).toMatchObject({ mode: 'safety', urgency: 'emergency' });
  });

  it('pai → eu: a nova queixa própria não herda o contexto do pai', async () => {
    const previous = 'Meu pai está com o olho vermelho e coçando.';
    const first = await chat(previous);
    expect(first.specialty?.id).toBe('oftalmologia');

    const next = await chat(
      'Agora sou eu: estou com dor no joelho depois de correr.',
      [previous],
      first.context,
    );

    expect(next.specialty?.id).toBe('ortopedia');
    expect(next.specialty?.id).not.toBe('oftalmologia');
  });

  it('mãe → ela: pronome mantém a mesma pessoa e o histórico útil', async () => {
    const previous = 'Minha mãe está com tontura desde hoje e não tem outros sintomas.';
    const first = await chat(previous);
    expect(first.specialty).not.toBeNull();

    generate.mockClear();
    await chat('Ela também está enjoada desde hoje.', [previous], first.context);

    if (generate.mock.calls.length) {
      expect(generate.mock.calls.at(-1)?.[0].history).toContain(previous);
    }
  });

  it('outro filho inicia novo episódio mesmo com a mesma relação familiar', async () => {
    const previous = 'Meu filho de 8 anos está com coriza desde ontem.';
    const first = await chat(previous);
    expect(first.specialty?.id).toBe('pediatria');

    const next = await chat(
      'Meu outro filho está com o olho vermelho e coçando.',
      [previous],
      first.context,
    );

    expect(next.specialty?.id).toBe('oftalmologia');
  });

  it('nova pessoa não herda especialidade em consulta por proximidade', async () => {
    const previous = 'Meu olho está vermelho e coçando.';
    const first = await chat(previous);
    expect(first.specialty?.id).toBe('oftalmologia');

    const next = await chat(
      'Meu avô está com tontura. Qual clínica fica mais perto?',
      [previous],
      first.context,
    );

    expect(next.specialty?.id).not.toBe('oftalmologia');
  });

  it('pedido de medicamento para nova pessoa não preserva a especialidade do paciente anterior', async () => {
    const previous = 'Meu olho está vermelho e coçando.';
    const first = await chat(previous);
    expect(first.context?.specialtyId).toBe('oftalmologia');

    const boundary = await chat(
      'Meu avô pode tomar Rivotril para a tontura?',
      [previous],
      first.context,
    );

    expect(boundary.mode).toBe('safety');
    expect(boundary.context?.specialtyId ?? null).toBeNull();
  });
});
