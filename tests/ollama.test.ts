import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOllamaProvider } from '../server/ai/ollama.js';
import { demoProvider } from '../server/ai/demo.js';
import { createProvider } from '../server/ai/factory.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { buildApp } from '../server/app.js';
import { setupConnected, checkSetup } from '../server/services/setup.js';
import { ingestDocument } from '../server/rag/ingest.js';
import { Retriever } from '../server/rag/retrieve.js';
import { prepareOllamaConfig } from '../scripts/local-config.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', AI_PROVIDER: 'ollama' });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const localDetails = { details: { format: 'gguf' }, capabilities: ['completion', 'embedding'] };
const answer = {
  answer: 'Faltam informações para orientar.',
  urgency: 'uncertain',
  specialtyIds: [],
  questions: [],
  sourceIds: [],
};
const chat = (content: unknown = answer, doneReason = 'stop') =>
  json({
    done: true,
    done_reason: doneReason,
    message: { role: 'assistant', content: JSON.stringify(content) },
  });

describe('Ollama local, sem credenciais ou saída para nuvem', () => {
  it('seleciona o provedor sem chave e exige endereço de loopback', () => {
    expect(createProvider(config).mode).toBe('ollama');
    expect(config.OPENAI_API_KEY).toBe('');
    for (const url of [
      'https://ollama.com',
      'http://10.0.0.1:11434',
      'http://user:password@localhost:11434',
      'http://localhost:11434/proxy',
    ])
      expect(() => readConfig({ AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: url })).toThrow('local');
    expect(() => readConfig({ AI_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen3:cloud' })).toThrow(
      'cloud',
    );
  });

  it('bloqueia alias remoto antes de enviar qualquer relato', async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      json({ ...localDetails, remote_host: 'https://ollama.com', remote_model: 'some-model' }),
    );
    const provider = createOllamaProvider(config, transport);
    await expect(provider.embed(['relato privado'])).rejects.toThrow('remotos');
    await expect(
      provider.generate({ message: 'relato privado', evidence: [], history: [] }),
    ).rejects.toThrow('remotos');
    expect(transport.mock.calls.every(([url]) => String(url).endsWith('/api/show'))).toBe(true);
    expect(JSON.stringify(transport.mock.calls)).not.toContain('relato privado');
  });

  it('valida dimensões nativas, lote completo e vetor não nulo', async () => {
    for (const embeddings of [
      [],
      [[1, 2]],
      [Array(1024).fill(0)],
      [[null, ...Array(1023).fill(1)]],
    ]) {
      const provider = createOllamaProvider(config, async (url) =>
        String(url).endsWith('/show') ? json(localDetails) : json({ embeddings }),
      );
      await expect(provider.embed(['teste'])).rejects.toThrow();
    }
  });

  it('exige JSON estruturado completo e omite streaming e pensamento', async () => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith('/show')) return json(localDetails);
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        stream: false,
        think: false,
        format: { type: 'object' },
        options: { num_ctx: 8192 },
      });
      expect(body.messages[0].role).toBe('system');
      expect(JSON.parse(body.messages[1].content).currentMessage).toBe('teste');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return chat();
    });
    expect(
      await createOllamaProvider(config, transport).generate({
        message: 'teste',
        evidence: [],
        history: [],
      }),
    ).toEqual(answer);
    for (const result of [
      chat(answer, 'length'),
      chat({ answer: 'incompleto' }),
      chat({ ...answer, sourceIds: ['fonte-inventada'] }),
      json({ done: false }),
    ]) {
      const provider = createOllamaProvider(config, async (url) =>
        String(url).endsWith('/show') ? json(localDetails) : result,
      );
      await expect(
        provider.generate({ message: 'teste', evidence: [], history: [] }),
      ).rejects.toThrow();
    }
  });

  it('explica modelo ausente e não revela corpo de erro do servidor', async () => {
    const missing = createOllamaProvider(config, async () => json({ error: 'private-data' }, 404));
    await expect(missing.embed(['teste'])).rejects.toThrow('ollama pull bge-m3');
    const failed = createOllamaProvider(config, async () => {
      throw new Error('private-data');
    });
    await expect(failed.embed(['teste'])).rejects.toThrow('Ollama indisponível');
  });

  it('interrompe transporte que excede o limite configurado', async () => {
    const provider = createOllamaProvider(
      { ...config, OLLAMA_TIMEOUT_MS: 25 },
      async (url, init) => {
        if (String(url).endsWith('/show')) return json(localDetails);
        return new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
        );
      },
    );
    await expect(provider.embed(['teste'])).rejects.toThrow('tempo esgotado');
  });
});

describe('RAG e catálogo com vetores locais de 1024 dimensões', () => {
  let db: Database;
  beforeAll(async () => {
    db = await connectDatabase(config);
    await migrate(db);
  });
  afterAll(async () => {
    await db?.close();
  });
  it('gera sem consentimento externo e isola vetores de outros modelos no mesmo banco', async () => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url).startsWith('http://127.0.0.1:11434/api/')).toBe(true);
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/show')) return json(localDetails);
      if (String(url).endsWith('/embed')) {
        expect(body.truncate).toBe(false);
        const values = await demoProvider.embed(body.input);
        return json({
          embeddings: values.map((v) =>
            Array.from({ length: 1024 }, (_, i) => v[i] + (v[i + 1024] ?? 0)),
          ),
        });
      }
      const evidence = JSON.parse(body.messages[1].content).retrievedEvidence;
      const source = evidence.find((item: { specialtyIds: string[] }) =>
        item.specialtyIds.includes('ortopedia'),
      );
      return chat(
        source
          ? {
              answer: 'Uma avaliação em ortopedia pode orientar o próximo passo.',
              urgency: 'routine',
              questions: [],
              specialtyIds: ['ortopedia'],
              sourceIds: [source.id],
            }
          : answer,
      );
    });
    const provider = createOllamaProvider(config, transport);
    expect(await setupConnected(db, config, provider)).toMatchObject({
      indexed: 8,
      publicClinics: 20,
    });
    expect(await setupConnected(db, config, provider)).toMatchObject({ indexed: 0 });
    const docs = JSON.parse(await readFile('data/knowledge.demo.json', 'utf8'));
    expect(await ingestDocument(db, provider, docs[0])).toBe(false);
    expect(await ingestDocument(db, provider, docs[0], { force: true })).toBe(true);
    await ingestDocument(db, demoProvider, { ...docs[0], id: 'different-dimensions' });
    const evidence = await new Retriever(db, provider, true).search('dor no pescoço');
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some((source) => source.id.startsWith('different-dimensions:'))).toBe(false);
    await db.query('DELETE FROM documents WHERE id=$1', ['different-dimensions']);
    const app = await buildApp(config, db, provider);
    try {
      expect((await app.inject('/api/catalog')).json()).toMatchObject({
        mode: 'ollama',
        requiresConsent: false,
        chatTimeoutMs: 390000,
        directory: { total: 20 },
      });
      const response = (
        await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload: {
            message: 'Estou com dor no pescoço',
            city: 'Fortaleza',
            insurance: 'CASSI',
            consent: false,
          },
        })
      ).json();
      expect(response).toMatchObject({ mode: 'ollama', specialtyIds: ['ortopedia'] });
      expect(response.clinics[0].id).toBe('public-cti');
      expect(response.sources).toHaveLength(1);
      expect(await checkSetup(db, config, provider, true)).toMatchObject({
        allPassed: true,
        liveVerified: true,
        clinicalReviewComplete: false,
      });
      const failed = await checkSetup(
        db,
        config,
        {
          ...provider,
          embed: async () => {
            throw new Error('private-data');
          },
        },
        true,
      );
      expect(failed.allPassed).toBe(false);
      expect(JSON.stringify(failed)).not.toContain('private-data');
    } finally {
      await app.close();
    }
  });
});

describe('Preparação automática do .env local', () => {
  it('cria sem chave, preserva configuração anterior e não sobrescreve configuração Ollama', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'medfinder-config-'));
    try {
      await cp('.env.ollama.example', join(directory, '.env.ollama.example'));
      expect(await prepareOllamaConfig(directory)).toEqual({ created: true, backup: null });
      await writeFile(join(directory, '.env'), 'AI_PROVIDER=openai\nOPENAI_API_KEY=fake-secret\n');
      const result = await prepareOllamaConfig(directory);
      expect(await readFile(join(directory, result.backup!), 'utf8')).toContain('fake-secret');
      expect(await readFile(join(directory, '.env'), 'utf8')).not.toContain('fake-secret');
      await writeFile(join(directory, '.env'), 'AI_PROVIDER=ollama\nOLLAMA_MODEL=qwen3:8b\n');
      expect(await prepareOllamaConfig(directory)).toEqual({ created: false, backup: null });
      expect(await readFile(join(directory, '.env'), 'utf8')).toContain('qwen3:8b');
      await writeFile(join(directory, '.env'), 'NODE_ENV=production\nAI_PROVIDER=openai\n');
      await expect(prepareOllamaConfig(directory)).rejects.toThrow('servidor');
      expect(await readFile(join(directory, '.env'), 'utf8')).toContain('NODE_ENV=production');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
