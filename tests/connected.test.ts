import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { buildApp } from '../server/app.js';
import { createOpenAIProvider } from '../server/ai/openai.js';
import { demoProvider } from '../server/ai/demo.js';
import { setupConnected, checkSetup } from '../server/services/setup.js';
const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', ALLOW_DEMO_DATA: 'false' });
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
describe('OpenAI + RAG + catálogo público sem API de diretório', () => {
  let db: Database;
  beforeAll(async () => {
    db = await connectDatabase(config);
    await migrate(db);
  });
  beforeEach(async () => {
    await db.exec('TRUNCATE clinics, catalog_collections, documents CASCADE');
  });
  afterAll(async () => {
    await db?.close();
  });
  it('gera com o SDK OpenAI + pgvector + catálogo real, usando somente transporte HTTP simulado', async () => {
    const connectedConfig = {
      ...config,
      AI_PROVIDER: 'openai' as const,
      OPENAI_API_KEY: 'fake-key',
      ALLOW_DEMO_DATA: true,
    };
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).includes('/embeddings')) {
        const vectors = await demoProvider.embed(body.input);
        return json({
          data: vectors.map((embedding, index) => ({ embedding, index })),
          model: connectedConfig.EMBEDDING_MODEL,
        });
      }
      expect(body.store).toBe(false);
      const evidence = JSON.parse(body.input[0].content).retrievedEvidence;
      return json({
        id: 'resp_fixture',
        object: 'response',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_fixture',
            role: 'assistant',
            status: 'completed',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  answer: evidence.length
                    ? 'Uma avaliação em ortopedia pode ajudar a orientar o próximo passo.'
                    : 'Faltam informações para orientar.',
                  urgency: evidence.length ? 'routine' : 'uncertain',
                  specialtyIds: evidence.length ? ['ortopedia'] : [],
                  sourceIds: evidence.length
                    ? [
                        evidence.find((item: { specialtyIds: string[] }) =>
                          item.specialtyIds.includes('ortopedia'),
                        ).id,
                      ]
                    : [],
                  questions: [],
                }),
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
      });
    });
    const provider = createOpenAIProvider(connectedConfig, transport);
    const result = await setupConnected(db, connectedConfig, provider);
    expect(result).toMatchObject({ publicClinics: 20, knowledgeRequiresClinicalReview: true });
    const app = await buildApp(connectedConfig, db, provider);
    try {
      const meta = (await app.inject('/api/catalog')).json();
      expect(meta.demoData).toBe(false);
      expect(meta.knowledge.demoDocuments).toBe(8);
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          message: 'Estou com dor no pescoço',
          city: 'Fortaleza',
          insurance: 'CASSI',
          consent: true,
        },
      });
      expect(response.json()).toMatchObject({ mode: 'openai', specialtyIds: ['ortopedia'] });
      expect(response.json().clinics[0].id).toBe('public-cti');
      expect(response.json().sources).toHaveLength(1);
      expect(transport).toHaveBeenCalled();
      const checks = await checkSetup(db, connectedConfig, provider);
      expect(checks).toMatchObject({
        allPassed: true,
        clinicalReviewComplete: false,
        liveVerified: false,
      });
      expect(checks.checks.map((check) => check.name)).not.toContain('doctoralia');
      expect(await checkSetup(db, connectedConfig, provider, true)).toMatchObject({
        allPassed: true,
        liveVerified: true,
        clinicalReviewComplete: false,
      });
      const offlineProvider = {
        ...provider,
        embed: async () => {
          throw new Error('secret-upstream-content');
        },
      };
      const failed = await checkSetup(db, connectedConfig, offlineProvider, true);
      expect(failed).toMatchObject({ allPassed: false, liveVerified: false });
      expect(JSON.stringify(failed)).not.toContain('secret-upstream-content');
      expect(
        transport.mock.calls.every(([url]) => String(url).startsWith('https://api.openai.com/')),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
});
