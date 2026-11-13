import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/app.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { seedDemo } from '../server/db/seed.js';
import { demoProvider } from '../server/ai/demo.js';
import type { AIProvider } from '../server/ai/provider.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { chatResponseSchema, modelAnswerSchema } from '../shared/contracts.js';
import { suggestion } from './fixtures.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://', CHAT_RATE_LIMIT: '100' });
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const fastPayload = {
  message: 'Estou com dor no pescoço desde ontem, piora ao movimentar, sem outros sintomas',
  city: 'Fortaleza',
  insurance: 'Plano Exemplo A',
};

beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  await seedDemo(db, demoProvider);
  app = await buildApp(config, db);
});
afterAll(async () => {
  await app?.close();
  await db?.close();
});

async function withProvider(provider: AIProvider, request: Record<string, unknown> = fastPayload) {
  const instance = await buildApp(config, db, provider);
  try {
    const response = await instance.inject({ method: 'POST', url: '/api/chat', payload: request });
    return { statusCode: response.statusCode, body: chatResponseSchema.parse(response.json()) };
  } finally {
    await instance.close();
  }
}

describe('Pipeline híbrido: roteador → SQL → RAG', () => {
  it('publica catálogo dinâmico e prontidão sem depender de RAG médico', async () => {
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
    const meta = await app.inject('/api/catalog');
    expect(meta.json().specialties).toContainEqual({ id: 'urologia', name: 'Urologia' });
    expect(meta.headers['cache-control']).toBe('no-store');
  });

  it('fast-path conecta queixa, especialidade, filtros exatos e RAG só das clínicas selecionadas', async () => {
    const body = chatResponseSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/chat', payload: fastPayload })).json(),
    );
    expect(body.specialty?.id).toBe('ortopedia');
    expect(body.clinics.map((clinic) => clinic.id)).toEqual(['demo-aldeota']);
    expect(body.sources.every((source) => !source.clinicId || source.clinicId === 'demo-aldeota')).toBe(
      true,
    );
    expect(body.ragStatus).toBe('available');
    expect(body.feedback?.token).toHaveLength(64);
  });

  it('caso real do olho chega a Oftalmologia sem depender do LLM', async () => {
    const provider = { ...demoProvider, generate: vi.fn() };
    const result = await withProvider(provider, {
      message: 'bom dia, meu olho esta avermelhado e coçando.',
    });
    expect(result.body.specialty?.id).toBe('oftalmologia');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('ambiguidade usa o modelo e limita a escolha à shortlist', async () => {
    const provider = {
      ...demoProvider,
      generate: vi.fn(async () => suggestion('Neurologia')),
    };
    const result = await withProvider(provider, { message: 'estou com tontura desde hoje e não tenho outros sintomas' });
    expect(result.body.specialty?.id).toBe('neurologia');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('especialidade fora da shortlist é descartada e recupera para Clínica Médica', async () => {
    const provider = {
      ...demoProvider,
      generate: vi.fn(async () => suggestion('Dermatologia')),
    };
    const result = await withProvider(provider, { message: 'estou com tontura desde hoje e não tenho outros sintomas' });
    expect(result.body.specialty?.id).toBe('clinica-medica');
  });

  it('falha de geração não interrompe a navegação: usa fallback amplo', async () => {
    const result = await withProvider(
      {
        ...demoProvider,
        generate: async () => {
          throw new Error('private-content');
        },
      },
      { message: 'estou com tontura desde hoje e não tenho outros sintomas' },
    );
    expect(result.body).toMatchObject({ mode: 'fallback', specialty: { id: 'clinica-medica' } });
    expect(JSON.stringify(result.body)).not.toContain('private-content');
  });

  it('falha de embeddings preserva especialidade e clínicas compatíveis', async () => {
    const result = await withProvider({
      ...demoProvider,
      embed: async () => {
        throw new Error('private-content');
      },
    });
    expect(result.body).toMatchObject({ status: 'ok', ragStatus: 'unavailable' });
    expect(result.body.specialty?.id).toBe('ortopedia');
    expect(result.body.clinics[0].id).toBe('demo-aldeota');
  });

  it('não troca especialidade para preencher resultados vazios e não relaxa filtros', async () => {
    const result = await withProvider(demoProvider, {
      message: 'tenho enxaqueca',
      city: 'Fortaleza',
      insurance: 'Plano Exemplo A',
    });
    expect(result.body.specialty?.id).toBe('neurologia');
    expect(result.body).toMatchObject({ status: 'no_matching_clinics', clinics: [] });
    expect(result.body.answer).toContain('filtros não foram relaxados automaticamente');
  });

  it('formato do modelo é mínimo e rejeita estruturas/texto livre antigos', () => {
    for (const output of [
      { ...suggestion(), specialty: [suggestion().specialty] },
      { ...suggestion(), specialties: [suggestion().specialty] },
      { ...suggestion(), specialty: { ...suggestion().specialty, priority: 'primary' } },
      { ...suggestion(), answer: 'texto que o backend não pediu' },
      { ...suggestion(), sourceIds: ['old-source'] },
      { ...suggestion(), questions: ['pattern', 'location', 'impact'] },
    ])
      expect(modelAnswerSchema.safeParse(output).success).toBe(false);
  });

  it('emergência tem prioridade sobre LLM, embeddings, localização e filtros', async () => {
    const provider = { ...demoProvider, generate: vi.fn(), embed: vi.fn() };
    const result = await withProvider(provider, {
      message: 'Estou com dor forte no peito e falta de ar',
      city: 'Fortaleza',
      insurance: 'Plano Exemplo A',
      location: { latitude: -3.73, longitude: -38.51 },
    });
    expect(result.body).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      specialty: null,
      clinics: [],
      locationUsed: false,
    });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
  });
});

describe('Taxonomia e resolução conservadora', () => {
  it('resolve nome e alias oficiais, sem fuzzy permissivo', async () => {
    const repo = new SpecialtyRepository(db);
    for (const name of ['REUMATOLOGIA', 'Reumatologista', '  reumatologia '])
      expect(await repo.resolve(name)).toMatchObject({
        status: 'resolved',
        specialty: { id: 'reumatologia' },
      });
    expect((await repo.resolve('Especialista em articulações')).status).toBe('unrecognized');
    expect((await repo.resolve('Reumatolgia')).status).toBe('unrecognized');
  });

  it('taxonomia ativa é dinâmica e Medicina de Família continua inativa', async () => {
    const repo = new SpecialtyRepository(db);
    expect((await repo.list()).length).toBeGreaterThanOrEqual(54);
    expect((await repo.resolve('Cirurgia Pediátrica')).status).toBe('resolved');
    expect((await repo.resolve('Medicina de Família e Comunidade')).status).toBe('not_registered');
  });
});

describe('Validação e proteção das APIs', () => {
  it('recusa campos extras, entradas fora do limite e origens externas', async () => {
    for (const body of [{ message: 'oi', injectedRole: 'system' }, { message: 'x'.repeat(2001) }])
      expect((await app.inject({ method: 'POST', url: '/api/chat', payload: body })).statusCode).toBe(
        400,
      );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/chat',
          payload: fastPayload,
          headers: { origin: 'https://outro.example' },
        })
      ).statusCode,
    ).toBe(403);
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/chat',
            payload: fastPayload,
            headers: { origin },
          })
        ).statusCode,
      ).toBe(200);
    expect((await app.inject('/api/clinics?page=-1')).statusCode).toBe(400);
    expect((await app.inject('/api/inexistente')).statusCode).toBe(404);
  });

  it('aplica rate limit próprio no chat', async () => {
    const limited = await buildApp({ ...config, CHAT_RATE_LIMIT: 1 }, db);
    try {
      await limited.inject({ method: 'POST', url: '/api/chat', payload: fastPayload });
      expect(
        (await limited.inject({ method: 'POST', url: '/api/chat', payload: fastPayload })).statusCode,
      ).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('OpenAI só exige consentimento quando a rota realmente precisa do modelo', async () => {
    const provider = { ...demoProvider, mode: 'openai' as const, generate: vi.fn(), embed: vi.fn() };
    const connected = await buildApp(config, db, provider);
    try {
      // The semantic model is used on the first clinical message;
      // consent is required before any data reaches the external provider.
      const firstWithoutConsent = await connected.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'meu olho está vermelho e coçando' },
      });
      expect(firstWithoutConsent.statusCode).toBe(400);
      expect(provider.generate).not.toHaveBeenCalled();

      const semantic = await connected.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'estou com tontura desde hoje e não tenho outros sintomas' },
      });
      expect(semantic.statusCode).toBe(400);

      const emergency = await connected.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { message: 'Não consigo respirar' },
      });
      expect(emergency.json().urgency).toBe('emergency');
    } finally {
      await connected.close();
    }
  });
});
