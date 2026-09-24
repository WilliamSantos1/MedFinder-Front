import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { seedDemo } from '../server/db/seed.js';
import { demoProvider } from '../server/ai/demo.js';
import { type AIProvider, vectorLiteral } from '../server/ai/provider.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { Retriever } from '../server/rag/retrieve.js';
import { ChatService } from '../server/services/chat.js';
import { chunkText, ingestDocument } from '../server/rag/ingest.js';
import { chatResponseSchema, documentSchema, type KnowledgeDocument } from '../shared/contracts.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', CHAT_RATE_LIMIT: '100' });
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
let docs: KnowledgeDocument[];
const payload = {
  message: 'Estou com dor no pescoço',
  city: 'Fortaleza',
  insurance: 'Plano Exemplo A',
};

beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await seedDemo(db, demoProvider);
  app = await buildApp(config, db);
  docs = JSON.parse(await readFile('data/knowledge.demo.json', 'utf8')) as KnowledgeDocument[];
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

describe('API + PostgreSQL real com pgvector', () => {
  it('responde à prontidão e publica as opções do catálogo', async () => {
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
    const response = await app.inject('/api/catalog');
    expect(response.json().cities).toEqual(['Fortaleza', 'São Paulo']);
    expect(response.json().mode).toBe('demo');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('conecta relato, especialidade, evidência e clínica filtrada', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload });
    expect(response.statusCode).toBe(200);
    const body = chatResponseSchema.parse(response.json());
    expect(body.mode).toBe('demo');
    expect(body.specialtyIds).toContain('ortopedia');
    expect(body.sources[0].url).toContain('neck-pain');
    expect(body.clinics.map((clinic) => clinic.id)).toEqual(['demo-aldeota']);
    expect(body.clinics[0].isDemo).toBe(true);
  });
  it('mantém o contexto numa resposta curta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { ...payload, history: [payload.message], message: 'Começou ontem, sem febre' },
    });
    expect(response.json().sources[0].url).toContain('neck-pain');
  });
  it('não inventa uma especialidade quando falta informação', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'Estou com dor' },
    });
    expect(response.json()).toMatchObject({
      urgency: 'uncertain',
      specialtyIds: [],
      clinics: [],
      sources: [],
    });
  });
  it('responde a emergência sem chamar embeddings ou modelo', async () => {
    const provider = { ...demoProvider, embed: vi.fn(), generate: vi.fn() };
    const safetyApp = await buildApp(config, db, provider);
    try {
      const response = await safetyApp.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'Estou com dor no peito' },
      });
      expect(response.json()).toMatchObject({
        urgency: 'emergency',
        clinics: [],
        specialtyIds: [],
        mode: 'safety',
      });
      expect(provider.embed).not.toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
    } finally {
      await safetyApp.close();
    }
  });
  it('valida entradas e origem, sem expor erros internos', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload: { message: 'oi', injectedRole: 'system' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload: { message: 'a'.repeat(2001) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload,
          headers: { origin: 'https://outro.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject('/api/clinics?page=-1')).statusCode).toBe(400);
    expect((await app.inject('/api/inexistente')).statusCode).toBe(404);
  });
  it('não alarga os filtros quando não há convênio compatível', async () => {
    const response = await app.inject('/api/clinics?city=Fortaleza&insurance=Plano%20inexistente');
    expect(response.json()).toMatchObject({ items: [], total: 0 });
    const injected = await app.inject(`/api/clinics?city=${encodeURIComponent("' OR 1=1 --")}`);
    expect(injected.json().items).toEqual([]);
  });
  it('normaliza acentos, cidade e convênio', async () => {
    const response = await app.inject('/api/clinics?city=sao%20paulo&specialty=dermatologia');
    expect(response.json().items.map((clinic: { id: string }) => clinic.id)).toEqual([
      'demo-sp-familia',
    ]);
  });
  it('aplica limite de requisições no chat', async () => {
    const limited = await buildApp({ ...config, CHAT_RATE_LIMIT: 1 }, db);
    try {
      await limited.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'dor no peito' },
      });
      const response = await limited.inject({ method: 'POST', url: '/api/chat', payload });
      expect(response.statusCode).toBe(429);
      expect(response.json().error).toContain('Aguarde');
    } finally {
      await limited.close();
    }
  });
  it('exige consentimento para processar um relato na OpenAI', async () => {
    const provider: AIProvider = {
      ...demoProvider,
      mode: 'openai',
      embed: vi.fn(demoProvider.embed),
    };
    const connected = await buildApp(config, db, provider);
    try {
      expect(
        (await connected.inject({ method: 'POST', url: '/api/chat', payload })).statusCode,
      ).toBe(400);
      expect(provider.embed).not.toHaveBeenCalled();
      expect(
        (
          await connected.inject({
            method: 'POST',
            url: '/api/chat',
            payload: { message: 'Não consigo respirar' },
          })
        ).json().urgency,
      ).toBe('emergency');
    } finally {
      await connected.close();
    }
  });
});

describe('RAG e governança dos dados', () => {
  it('retorna a evidência correspondente em diferentes queixas', async () => {
    const retriever = new Retriever(db, demoProvider, true);
    for (const [query, expected] of [
      ['pescoço', 'pescoco'],
      ['pele coçando', 'pele'],
      ['ouvido doendo', 'ouvido'],
      ['estômago', 'abdomen'],
      ['cabeça', 'cabeca'],
      ['olhos', 'olhos'],
      ['ansiedade', 'ansiedade'],
      ['lombar', 'costas'],
    ]) {
      expect((await retriever.search(query))[0].id).toContain(expected);
    }
  });
  it('ingestão é idempotente e não multiplica chunks', async () => {
    const before = await db.query<{ count: string }>('SELECT count(*) FROM chunks');
    expect(await ingestDocument(db, demoProvider, docs[0])).toBe(false);
    const after = await db.query<{ count: string }>('SELECT count(*) FROM chunks');
    expect(after.rows[0].count).toBe(before.rows[0].count);
    await migrate(db);
  });
  it('preserva a versão anterior se o provedor falha ao reindexar', async () => {
    const broken = {
      ...demoProvider,
      embed: async () => {
        throw new Error('offline');
      },
    };
    await expect(
      ingestDocument(db, broken, { ...docs[0], content: `${docs[0].content} Nova revisão.` }),
    ).rejects.toThrow('offline');
    expect(
      (await new Retriever(db, demoProvider, true).search('pescoço'))[0].content,
    ).not.toContain('Nova revisão');
  });
  it('não mistura vetores de modelos diferentes', async () => {
    const other = { ...demoProvider, embeddingModel: 'another-model:1536' };
    expect(await new Retriever(db, other, true).search('pescoço')).toEqual([]);
  });
  it('oculta dados fictícios sem autorização explícita', async () => {
    expect(await new Retriever(db, demoProvider, false).search('pescoço')).toEqual([]);
    expect(
      (
        await new CatalogRepository(db, false).search({
          city: '',
          insurance: '',
          specialty: '',
          page: 1,
        })
      ).items,
    ).toEqual([]);
  });
  it('exige aprovação identificada para conhecimento real', () => {
    expect(() =>
      documentSchema.parse({ ...docs[0], isDemo: false, reviewStatus: 'approved' }),
    ).toThrow();
    expect(() => documentSchema.parse({ ...docs[0], sourceUrl: 'javascript:alert(1)' })).toThrow();
  });
  it('divide texto longo sem exceder tamanho nem perder o final', () => {
    const text = Array(300).fill('contexto de atendimento').join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 900)).toBe(true);
    expect(chunks.at(-1)?.endsWith('atendimento')).toBe(true);
    expect(() => vectorLiteral([1, 2])).toThrow();
  });
  it('rejeita fontes e especialidades inventadas pelo modelo', async () => {
    const bad: AIProvider = {
      ...demoProvider,
      generate: async () => ({
        answer: 'Procure uma clínica.',
        urgency: 'routine',
        specialtyIds: ['oftalmologia'],
        questions: [],
        sourceIds: ['inventada'],
      }),
    };
    const service = new ChatService(
      new Retriever(db, bad, true),
      bad,
      new CatalogRepository(db, true),
    );
    expect(await service.answer({ ...payload, history: [], consent: false })).toMatchObject({
      mode: 'fallback',
      clinics: [],
      sources: [],
    });
  });
  it('falha de rede não fabrica resposta médica', async () => {
    const broken = {
      ...demoProvider,
      embed: async () => {
        throw new Error('sensitive prompt');
      },
    };
    const service = new ChatService(
      new Retriever(db, broken, true),
      broken,
      new CatalogRepository(db, true),
    );
    const response = await service.answer({ ...payload, history: [], consent: false });
    expect(response.mode).toBe('fallback');
    expect(JSON.stringify(response)).not.toContain('sensitive');
  });
  it('não cria tabela de histórico de saúde', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      'catalog_collections',
      'chunks',
      'clinics',
      'documents',
      'integration_state',
      'schema_migrations',
    ]);
  });
});

describe('Configuração explícita', () => {
  it('impede modo de produção com dados demonstrativos', () =>
    expect(() => readConfig({ NODE_ENV: 'production' })).toThrow());
  it('impede modo OpenAI sem chave', () =>
    expect(() => readConfig({ AI_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY'));
  it('não interpreta a string false como true', () =>
    expect(readConfig({ ALLOW_DEMO_DATA: 'false' }).ALLOW_DEMO_DATA).toBe(false));
});
