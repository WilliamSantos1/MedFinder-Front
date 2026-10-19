import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { demoProvider } from '../server/ai/demo.js';
import { chatResponseSchema } from '../shared/contracts.js';
import { clinic, suggestion } from './fixtures.js';

const config = readConfig({
  NODE_ENV: 'test',
  DATA_DIR: 'memory://',
  CHAT_RATE_LIMIT: '120',
  FEEDBACK_RATE_LIMIT: '120',
});
const provider = { ...demoProvider, generate: vi.fn(async () => suggestion()) };
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await new CatalogRepository(db, true).import([
    clinic({ id: 'demo-visita', name: 'Clínica Visita' }),
  ]);
  app = await buildApp(config, db, provider);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

async function receipt() {
  const response = chatResponseSchema.parse(
    (
      await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'ardência ao urinar desde ontem, sem febre' },
      })
    ).json(),
  );
  return {
    responseId: response.id,
    token: response.feedback!.token,
    clinicId: response.clinics[0].id,
  };
}
const send = (payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/visit-feedback',
    payload: payload as Record<string, unknown>,
  });

describe('Avaliação de visita à clínica indicada', () => {
  it('salva, atualiza por UPSERT e redige identificadores', async () => {
    const r = await receipt();
    expect((await send({ ...r, rating: 5 })).json()).toEqual({ status: 'saved' });
    expect(
      (await send({ ...r, rating: 3, comment: ' Bom. pessoa@example.com (85) 99999-1234 ' }))
        .statusCode,
    ).toBe(200);
    const { rows } = await db.query<{ rating: number; comment: string }>(
      'SELECT rating,comment FROM clinic_visit_feedback WHERE response_id=$1',
      [r.responseId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(3);
    expect(rows[0].comment).not.toMatch(/pessoa@|99999/);
  });
  it('rejeita clínica não indicada, token errado, nota inválida, campos extras e comprovante expirado', async () => {
    const r = await receipt();
    for (const extra of [
      { clinicId: 'demo-outra-clinica' },
      { token: 'f'.repeat(64) },
      { rating: 0 },
      { rating: 6 },
      { rating: 4.5 },
      { comment: 'x'.repeat(501) },
      { visitorId: 'abc' },
    ])
      expect((await send({ ...r, rating: 4, ...extra })).statusCode).toBe(400);
    await db.query(
      "UPDATE response_receipts SET created_at=now()-interval '8 days' WHERE response_id=$1",
      [r.responseId],
    );
    expect((await send({ ...r, rating: 4 })).statusCode).toBe(400);
  });
});
