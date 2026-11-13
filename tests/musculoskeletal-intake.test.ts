import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { demoProvider } from '../server/ai/demo.js';
import { chatResponseSchema, type ChatContext } from '../shared/contracts.js';
import {
  needsMusculoskeletalIntake,
  musculoskeletalIntakeTopics,
} from '../server/domain/musculoskeletal-interview.js';
import { patientProfile } from '../server/domain/patient.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', CHAT_RATE_LIMIT: '120' });
const generate = vi.fn(demoProvider.generate);
const provider = { ...demoProvider, generate };
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;

async function chat(message: string, history: string[] = [], context?: ChatContext | null) {
  const response = await app.inject({
    method: 'POST', url: '/api/chat',
    payload: { message, history, context: context ?? undefined },
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
  generate.mockReset().mockImplementation(demoProvider.generate);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Entrevista por sintomas e proteção contra herança indevida de Pediatria', () => {
  it.each([
    'Bom dia, estou com uma dor nas costas, o que fazer?',
    'estou com dor no pé',
    'Estou sentindo dor no ombro.',
    'Meu joelho está doendo.',
  ])('não escolhe Ortopedia ou Pediatria de imediato: %s', async (message) => {
    const result = await chat(message);
    expect(result.status).toBe('needs_information');
    expect(result.specialty).toBeNull();
    expect(result.clinics).toEqual([]);
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.join(' ')).toMatch(/tempo|começou|sintomas|inchaço|fraqueza/i);
    expect(generate).not.toHaveBeenCalled();
  });

  it('dor nas costas pergunta, integra a resposta e só então navega', async () => {
    const initial = 'Bom dia, estou com dor nas costas. O que fazer?';
    const first = await chat(initial);
    const secondMessage = 'Começou ontem, sem outros sintomas, piora depois de um esforço.';
    const second = await chat(secondMessage, [initial], first.context);
    expect(second.status).toBe('ok');
    expect(second.specialty?.id).not.toBe('pediatria');
    expect(second.specialty?.id).toMatch(/^(ortopedia|clinica-medica|neurologia)$/);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('resposta incompleta gera pergunta relevante, não uma especialidade arbitrária', async () => {
    const initial = 'estou com dor no pé';
    const first = await chat(initial);
    const second = await chat('começou ontem', [initial], first.context);
    expect(second.status).toBe('needs_information');
    expect(second.specialty).toBeNull();
    expect(second.questions.join(' ')).toMatch(/inchaço|dormência|sintoma/i);
  });

  it('não traz idade de criança ao trocar para a pessoa que escreve', async () => {
    const child = 'Meu filho de 8 anos está com coriza desde ontem.';
    const first = await chat(child);
    expect(first.specialty?.id).toBe('pediatria');
    const second = await chat(
      'Bom dia, estou com dor nas costas. O que faço?', [child], first.context,
    );
    expect(second.status).toBe('needs_information');
    expect(second.specialty).toBeNull();
    expect(second.questions.length).toBeGreaterThan(0);
  });

  it('bloqueia Pediatria inventada pelo modelo quando idade não foi fornecida', async () => {
    const firstMessage = 'estou com dor no ombro';
    const first = await chat(firstMessage);
    generate.mockResolvedValueOnce({
      urgency: 'routine', specialty: { name: 'Pediatria' }, questions: [],
    });
    const second = await chat(
      'Começou ontem após exercício e não tenho outros sintomas.',
      [firstMessage], first.context,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    // Após esforço, o roteador atualizado recupera Ortopedia mesmo quando
    // a LLM tenta inventar Pediatria. A proteção continua sendo testada.
    expect(second.specialty?.id).toBe('ortopedia');
    expect(second.specialty?.id).not.toBe('pediatria');
    expect(second.clinics.every((clinic) => clinic.specialties.includes('ortopedia'))).toBe(true);
  });

  it('mantém o alerta de emergência acima de qualquer entrevista', async () => {
    const result = await chat('Tenho dor nas costas e fraqueza nas duas pernas.');
    expect(result.mode).toBe('safety');
    expect(result.urgency).toBe('emergency');
    expect(result.clinics).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it('pergunta explícita sobre clínicas não vira entrevista clínica', async () => {
    const result = await chat('Quais clínicas de ortopedia atendem dor no pé?');
    expect(result.mode).toBe('catalog');
    expect(result.intent).toBe('clinic_search');
    expect(result.clinics.length).toBeGreaterThan(0);
  });

  it('resposta curta "não" à pergunta sobre sintomas é contabilizada', () => {
    const first = 'dor no pé';
    const second = 'Começou ontem depois da corrida';
    const previous = {
      questions: ['associated_symptoms' as const],
      askedTopics: ['onset_duration' as const, 'associated_symptoms' as const],
      round: 1,
    };
    expect(musculoskeletalIntakeTopics([first, second, 'não'], previous)).toEqual([]);
  });

  it('detector não usa órgão isolado ou pergunta sobre serviços como dor clínica', () => {
    expect(needsMusculoskeletalIntake(['dor no pé'])).toBe(true);
    expect(needsMusculoskeletalIntake(['Quero saber as clínicas de ortopedia'])).toBe(false);
    expect(patientProfile(['estou com dor nas costas']).ageYears).toBeNull();
  });
});
