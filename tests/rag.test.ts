import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { clinicDocumentSchema } from '../shared/contracts.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { seedDemo } from '../server/db/seed.js';
import { readConfig } from '../server/config.js';
import { demoProvider } from '../server/ai/demo.js';
import { vectorLiteral } from '../server/ai/provider.js';
import { chunkText, ingestDocument } from '../server/rag/ingest.js';
import { Retriever } from '../server/rag/retrieve.js';

let db: Database;
const docs = z
  .array(clinicDocumentSchema)
  .parse(JSON.parse(await readFile('data/clinic-documents.demo.json', 'utf8')));
beforeAll(async () => {
  db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
  await migrate(db);
  await seedDemo(db, demoProvider);
});
afterAll(async () => {
  await db?.close();
});
describe('RAG textual de clínicas com pgvector', () => {
  it('não recupera clínicas eliminadas pelo SQL', async () => {
    const retriever = new Retriever(db, demoProvider, true);
    expect(
      (await retriever.search('ortopedia atendimento adulto', ['demo-aldeota'])).sources.map(
        (s) => s.clinicId,
      ),
    ).toEqual(['demo-aldeota']);
    const other = await retriever.search('ortopedia atendimento adulto', ['demo-urologia']);
    expect(other.sources.every((s) => s.clinicId === 'demo-urologia')).toBe(true);
    expect((await retriever.search('ortopedia', [])).sources).toEqual([]);
  });
  it('não chama embedding se não há documentos permitidos ou modelo compatível', async () => {
    const provider = { ...demoProvider, embeddingModel: 'different:2', embed: vi.fn() };
    expect(
      (await new Retriever(db, provider, true).search('ortopedia', ['demo-aldeota'])).status,
    ).toBe('not_indexed');
    expect(provider.embed).not.toHaveBeenCalled();
    expect(
      (await new Retriever(db, demoProvider, false).search('ortopedia', ['demo-aldeota'])).sources,
    ).toEqual([]);
  });
  it('é idempotente e preserva versão anterior numa falha de reindexação', async () => {
    expect(await ingestDocument(db, demoProvider, docs[0])).toBe(false);
    const before = await db.query('SELECT * FROM clinic_chunks ORDER BY id');
    await expect(
      ingestDocument(
        db,
        {
          ...demoProvider,
          embed: async () => {
            throw new Error('offline');
          },
        },
        { ...docs[0], content: docs[0].content + ' Revisão.' },
      ),
    ).rejects.toThrow('offline');
    expect(await db.query('SELECT * FROM clinic_chunks ORDER BY id')).toEqual(before);
    await migrate(db);
  });
  it('impede misturar documento real e clínica fictícia e valida fonte/data', async () => {
    await expect(
      ingestDocument(db, demoProvider, {
        ...docs[0],
        isDemo: false,
        sourceUrl: 'https://example.org',
        verifiedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow('mesmo tipo');
    expect(clinicDocumentSchema.safeParse({ ...docs[0], isDemo: false }).success).toBe(false);
    expect(
      clinicDocumentSchema.safeParse({ ...docs[0], sourceUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
  it('divide documentos sem perder o final e rejeita vetores inválidos', () => {
    const chunks = chunkText(Array(300).fill('contexto de atendimento').join(' '));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 900)).toBe(true);
    expect(chunks.at(-1)?.endsWith('atendimento')).toBe(true);
    expect(() => vectorLiteral([1, 2])).toThrow();
    expect(() => chunkText('x', 2, 3)).toThrow();
  });
});
