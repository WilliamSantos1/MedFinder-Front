import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';
import { demoProvider } from '../server/ai/demo.js';
import { chatResponseSchema } from '../shared/contracts.js';
import { suggestion } from './fixtures.js';
const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', CHAT_RATE_LIMIT: '120' });
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const generate = vi.fn(async () => suggestion('Oculista'));
const provider = { ...demoProvider, generate };
const location = { latitude: -3.7321, longitude: -38.5151 };
async function chat(message: string, extra: Record<string, unknown> = {}) {
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
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Uma especialidade canônica, sem vazamento de texto do modelo', () => {
  it.each(['Oculista', 'oftalmo', 'OFTALMOLOGISTA'])(
    'normaliza %s e fornece a taxonomia ao modelo',
    async (alias) => {
      generate.mockResolvedValueOnce({
        ...suggestion(alias),
        answer: `Uma avaliação em ${alias} e Neurologia pode ajudar.`,
        specialty: { name: alias, reason: `Avaliação em ${alias} ou Neurologia.` },
      });
      const result = await chat('dor no olho desde ontem, sem outros sintomas');
      expect(result.specialty).toMatchObject({ id: 'oftalmologia', name: 'Oftalmologia' });
      expect(result).not.toHaveProperty('specialties');
      expect(result.questions).toEqual([]);
      expect(result.answer).not.toMatch(/oculista|oftalmo|neurologia/i);
      expect(generate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          specialties: expect.arrayContaining([{ id: 'oftalmologia', name: 'Oftalmologia' }]),
        }),
      );
    },
  );
  it('regressão: pai com dor no olho, 60 anos', async () => {
    const message = 'meu pai está com dor no olho, onde devo levar ele. ele tem 60 anos';
    const first = await chat(message);
    expect(first).toMatchObject({ status: 'needs_information', specialty: null, clinics: [] });
    const result = await chat('Desde ontem, com ardência e sem outros sintomas.', {
      history: [message],
      context: first.context,
    });
    expect(result.specialty?.name).toBe('Oftalmologia');
    expect(JSON.stringify(result)).not.toMatch(/oculista|alternative|primary/i);
    expect(result.clinics.every((c) => c.specialties.includes('oftalmologia'))).toBe(true);
  });
  it('descarta integralmente saída com especialidade inventada', async () => {
    const name = 'Especialista ocular avançado';
    generate.mockResolvedValueOnce({ ...suggestion(name), answer: `Você procura ${name}?` });
    const result = await chat('dor no olho desde ontem, sem outros sintomas');
    expect(result).toMatchObject({
      status: 'specialty_unrecognized',
      specialty: null,
      clinics: [],
    });
    expect(JSON.stringify(result)).not.toContain(name);
    expect((await new SpecialtyRepository(db).resolve(name)).status).toBe('unrecognized');
  });
  it('não força indicação quando falta contexto e rejeita inativas', async () => {
    generate.mockResolvedValueOnce({ ...suggestion(), specialty: null, urgency: 'uncertain' });
    expect((await chat('Estou com dor')).specialty).toBeNull();
    generate.mockResolvedValueOnce(suggestion('Radiologia'));
    expect(await chat('Estou com dor no olho desde ontem, sem outros sintomas')).toMatchObject({
      status: 'specialty_not_registered',
      specialty: null,
    });
  });
});

describe('Intenções de catálogo e continuidade', () => {
  it.each([
    'qual clínica de oftalmologia está mais perto de mim?',
    'tem alguma clínica de dermatologia perto de mim?',
    'Existe clínica de urologia em Fortaleza?',
    'Me mostre opções próximas para dermatologia.',
  ])('%s não exige inferência médica', async (message) => {
    generate.mockClear();
    const result = await chat(message, { location });
    expect(result.intent).toBe('clinic_search');
    expect(result.mode).toBe('catalog');
    expect(result.specialty).not.toBeNull();
    expect(generate).not.toHaveBeenCalled();
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(result.clinics.every((c) => c.distanceKm !== null)).toBe(true);
    const distances = result.clinics.map((c) => c.distanceKm!);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
  it('busca Unimed sem sintomas e pede esclarecimento para convênio desconhecido', async () => {
    const result = await chat('quais clínicas aceitam Unimed?');
    expect(result.specialty).toBeNull();
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(result.clinics.every((c) => c.insurances.includes('Unimed'))).toBe(true);
    expect(result.feedback?.reasons).toContain('insurance_problem');
    expect(await chat('quais clínicas aceitam Plano Inventado?')).toMatchObject({
      status: 'needs_information',
      clinics: [],
    });
  });
  it('responde endereço e especialidades da clínica a partir do banco', async () => {
    generate.mockClear();
    for (const message of [
      'onde fica a Clínica CTI?',
      'A Clínica CTI atende qual especialidade?',
    ]) {
      const result = await chat(message);
      expect(result.intent).toBe('clinic_information');
      expect(result.clinics.map((c) => c.id)).toEqual(['public-cti']);
      expect(result.answer).toContain('Rua Júlio Lima, 675');
      expect(result.clinics[0].specialtyDetails).toContainEqual({
        id: 'ortopedia',
        name: 'Ortopedia e Traumatologia',
      });
    }
    expect(generate).not.toHaveBeenCalled();
    expect(await chat('onde fica a Clínica Inexistente?')).toMatchObject({
      status: 'needs_information',
      clinics: [],
    });
  });
  it('refina especialidade pelo contexto e ordena as unidades anteriores', async () => {
    const eye = await chat('Estou com dor no olho desde ontem, sem outros sintomas');
    generate.mockClear();
    const nearby = await chat('qual dessas fica mais perto de mim?', {
      context: eye.context,
      history: ['Estou com dor no olho'],
      location,
    });
    expect(nearby.specialty?.id).toBe('oftalmologia');
    expect(nearby.clinics.every((c) => eye.context?.clinicIds.includes(c.id))).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    const ortho = await chat('quero clínica de ortopedia');
    const filtered = await chat('e que aceite Unimed?', { context: ortho.context });
    expect(filtered.specialty?.id).toBe('ortopedia');
    expect(filtered.context?.insurance).toBe('Unimed');
    expect(
      filtered.clinics.every(
        (c) => c.insurances.includes('Unimed') && c.specialties.includes('ortopedia'),
      ),
    ).toBe(true);
  });
  it('cidade selecionada permanece exata; pede permissão de localização sem inventar distância', async () => {
    const result = await chat('qual clínica de oftalmologia fica mais perto?', {
      city: 'Eusébio',
      location,
    });
    expect(result.clinics.length).toBeGreaterThan(0);
    expect(result.clinics.every((c) => c.city === 'Eusébio')).toBe(true);
    const noLocation = await chat('qual clínica de oftalmologia fica mais perto?');
    expect(noLocation.locationUsed).toBe(false);
    expect(noLocation.questions.join(' ')).toContain('Usar minha localização');
    expect(noLocation.clinics.every((c) => c.distanceKm === null)).toBe(true);
  });
  it('urgência vence pedido de catálogo e contexto; múltiplas áreas exigem escolha', async () => {
    generate.mockClear();
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
    expect(await chat('quero uma clínica de ortopedia e dermatologia')).toMatchObject({
      status: 'needs_information',
      specialty: null,
      clinics: [],
    });
  });
  it('catálogo funciona em modo OpenAI sem enviar nada ao provedor nem exigir consentimento', async () => {
    const external = { ...provider, mode: 'openai' as const, generate: vi.fn(), embed: vi.fn() };
    const instance = await buildApp(config, db, external);
    try {
      const result = await instance.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'onde fica a Clínica CTI?' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().mode).toBe('catalog');
      expect(external.generate).not.toHaveBeenCalled();
      expect(external.embed).not.toHaveBeenCalled();
    } finally {
      await instance.close();
    }
  });
});
