import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { distanceKm } from '../server/domain/distance.js';
import { demoProvider } from '../server/ai/demo.js';
import { clinicSearchSchema, chatResponseSchema } from '../shared/contracts.js';
import { clinic, suggestion } from './fixtures.js';

const config = readConfig({
  NODE_ENV: 'test',
  DATA_DIR: 'memory://',
  CHAT_RATE_LIMIT: '120',
  FEEDBACK_RATE_LIMIT: '120',
});
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let catalog: CatalogRepository;
const filters = { city: '', insurance: '', specialty: 'urologia', page: 1 };
const provider = {
  ...demoProvider,
  generate: vi.fn(async () => suggestion()),
  embed: vi.fn(demoProvider.embed),
};
beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  catalog = new CatalogRepository(db, true);
  await catalog.import([
    ...Array.from({ length: 9 }, (_, i) =>
      clinic({ id: `demo-${i}`, name: `Unidade ${i}`, latitude: 0, longitude: (9 - i) / 10 }),
    ),
    clinic({ id: 'demo-unknown', name: 'AAA sem coordenadas' }),
    clinic({
      id: 'demo-neighbor',
      name: 'Município vizinho',
      city: 'Caucaia',
      latitude: 0,
      longitude: 0.01,
    }),
    clinic({ id: 'demo-wrong-insurance', latitude: 0, longitude: 0, insurances: ['Outro plano'] }),
    clinic({
      id: 'demo-wrong-specialty',
      latitude: 0,
      longitude: 0,
      specialties: ['dermatologia'],
    }),
    clinic({ id: 'demo-inactive', latitude: 0, longitude: 0, active: false }),
  ]);
  app = await buildApp(config, db, provider);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('Geolocalização temporária e Haversine', () => {
  it('calcula distância conhecida, ponto idêntico e antípodas', () => {
    expect(distanceKm(0, 0, 0, 0)).toBe(0);
    expect(distanceKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
    expect(distanceKm(0, 0, 0, 180)).toBeCloseTo(20015.087, 2);
    for (const value of [NaN, Infinity, 91]) expect(() => distanceKm(value, 0, 0, 0)).toThrow();
  });
  it('ordena TODOS os candidatos antes de paginar; não alarga filtros', async () => {
    const search = {
      ...filters,
      insurance: 'Plano Exemplo A',
      location: { latitude: 0, longitude: 0 },
    };
    const first = await catalog.search(search);
    const second = await catalog.search({ ...search, page: 2 });
    const items = [...first.items, ...second.items];
    expect(first).toMatchObject({ total: 11, order: 'proximity' });
    expect(first.items[0].id).toBe('demo-neighbor');
    expect(first.items[1].id).toBe('demo-8');
    expect(items.at(-1)).toMatchObject({ id: 'demo-unknown', distanceKm: null });
    expect(new Set(items.map((c) => c.id)).size).toBe(11);
    const distances = items.flatMap((c) => (c.distanceKm === null ? [] : [c.distanceKm]));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(
      (await catalog.search({ ...search, city: 'Fortaleza' })).items.every(
        (c) => c.city === 'Fortaleza',
      ),
    ).toBe(true);
    expect((await catalog.search({ ...search, city: 'Fort' })).total).toBe(0);
    expect((await catalog.search({ ...search, insurance: 'Plano' })).total).toBe(0);
    expect((await catalog.search({ ...search, city: "' OR 1=1 --" })).total).toBe(0);
    expect((await catalog.search({ ...search, specialty: 'inexistente' })).total).toBe(0);
  });
  it('usa POST e recusa coordenadas inválidas e coordenadas na URL legada', async () => {
    for (const location of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: '0', longitude: 0 },
      { latitude: null, longitude: 0 },
      { latitude: 0 },
      { latitude: 0, longitude: 0, history: 'x' },
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/api/clinics/search', payload: { location } }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/chat',
            payload: { message: 'ardência ao urinar', location },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      clinicSearchSchema.safeParse({ location: { latitude: Infinity, longitude: 0 } }).success,
    ).toBe(false);
    expect((await app.inject('/api/clinics?latitude=0&longitude=0')).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/clinics/search',
          payload: { ...filters, location: { latitude: 0, longitude: 0 } },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('coordenadas não chegam ao modelo ou à persistência, apenas ao catálogo', async () => {
    provider.generate.mockClear();
    provider.embed.mockClear();
    const coordinates = { latitude: 57.123456, longitude: 99.898989 };
    const result = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        message: 'ardência ao urinar desde ontem, sem febre pessoa@example.com',
        location: coordinates,
      },
    });
    expect(result.json().locationUsed).toBe(true);
    expect(provider.generate).toHaveBeenCalledWith({
      message: 'ardência ao urinar desde ontem, sem febre [e-mail removido]',
      history: [],
      previousQuestions: [],
      patient: { relationship: null, ageYears: null, adultReported: false, needsAge: false },
      specialties: expect.arrayContaining([{ id: 'urologia', name: 'Urologia' }]),
    });
    expect(provider.embed).not.toHaveBeenCalled();
    const tables = (
      await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
      )
    ).rows;
    for (const { table_name } of tables) {
      // Names come only from PostgreSQL metadata, never user input.
      const rows = await db.query(`SELECT row_to_json(t) FROM "${table_name}" t`);
      expect(JSON.stringify(rows)).not.toMatch(/57\.123456|99\.898989|ardência ao urinar/);
    }
  });
  it('não cria especialidades arbitrárias na importação e não aceita coordenadas reais sem fonte', async () => {
    await expect(catalog.import([clinic({ specialties: ['nao-cadastrada'] })])).rejects.toThrow(
      'Cadastre',
    );
    expect(() =>
      clinic({
        isDemo: false,
        sourceUrl: 'https://example.org',
        verifiedAt: new Date().toISOString(),
        latitude: 0,
        longitude: 0,
      }),
    ).toThrow('Coordenadas reais');
  });
});

describe('Feedback isolado, sem conversa ou localização', () => {
  async function receipt(emergency = false) {
    const response = chatResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload: {
            message: emergency ? 'dor no peito' : 'ardência ao urinar desde ontem, sem febre',
            insurance: 'Plano Exemplo A',
          },
        })
      ).json(),
    );
    return { responseId: response.id, token: response.feedback!.token };
  }
  const send = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: payload as Record<string, unknown>,
    });
  it('salva positivo e permite mudar para negativo via UPSERT, redigindo identificadores', async () => {
    const response = await receipt();
    const calls = provider.generate.mock.calls.length;
    expect((await send({ ...response, rating: 'positive' })).json()).toEqual({ status: 'saved' });
    expect(
      (
        await send({
          ...response,
          rating: 'negative',
          reason: 'unclear_answer',
          comment:
            '  CPF 123.456.789-00 pessoa@example.com (85) 99999-1234 (85) 3333-4444. Texto confuso.  ',
        })
      ).statusCode,
    ).toBe(200);
    const { rows } = await db.query<{
      rating: string;
      comment: string;
      mode: string;
      prompt_version: string;
    }>('SELECT * FROM ai_feedback WHERE response_id=$1', [response.responseId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rating: 'negative',
      mode: 'demo',
      prompt_version: 'care-navigation-2.3.0',
    });
    expect(rows[0].comment).not.toMatch(/123\.456|pessoa@|99999|3333/);
    expect(rows[0].comment).toContain('Texto confuso');
    expect(provider.generate.mock.calls.length).toBe(calls);
    await send({ ...response, rating: 'positive' });
    expect(
      (
        await db.query<{ reason: null; comment: null }>(
          'SELECT reason,comment FROM ai_feedback WHERE response_id=$1',
          [response.responseId],
        )
      ).rows[0],
    ).toEqual({ reason: null, comment: null });
  });
  it('valida voto, motivo contextual, tamanho, campos extras, token e resposta existente', async () => {
    const response = await receipt(true);
    for (const extra of [
      { rating: 'other' },
      { rating: 'negative' },
      { rating: 'negative', reason: 'inventado' },
      { rating: 'negative', reason: 'incorrect_specialty' },
      { rating: 'negative', reason: 'location_problem' },
      { rating: 'negative', reason: 'clinic_problem' },
      { rating: 'negative', reason: 'other', comment: 'x'.repeat(501) },
      { rating: 'positive', mode: 'ollama' },
      { rating: 'positive', latitude: 1 },
      { rating: 'positive', token: 'f'.repeat(64) },
    ])
      expect((await send({ ...response, ...extra })).statusCode).toBe(400);
    expect(
      (
        await send({
          ...response,
          responseId: 'd5358b14-5d54-4d16-9d97-81aa2d757572',
          rating: 'positive',
        })
      ).statusCode,
    ).toBe(400);
    await send({ ...response, rating: 'negative', reason: 'not_helpful' });
    expect(
      (
        await app.inject({ method: 'POST', url: '/api/chat', payload: { message: 'dor no peito' } })
      ).json().urgency,
    ).toBe('emergency');
    expect((await app.inject('/api/feedback')).statusCode).toBe(404);
  });
  it('aplica rate limit próprio e expira comprovantes', async () => {
    const response = await receipt();
    const limited = await buildApp({ ...config, FEEDBACK_RATE_LIMIT: 1 }, db, provider);
    try {
      const request = {
        method: 'POST' as const,
        url: '/api/feedback',
        payload: { ...response, rating: 'positive' },
      };
      expect((await limited.inject(request)).statusCode).toBe(200);
      expect((await limited.inject(request)).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
    await db.query(
      "UPDATE response_receipts SET created_at=now()-interval '8 days' WHERE response_id=$1",
      [response.responseId],
    );
    expect((await send({ ...response, rating: 'positive' })).statusCode).toBe(400);
  });
});
