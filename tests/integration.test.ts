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
const payload = {
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
async function withProvider(provider: AIProvider, request = payload) {
  const instance = await buildApp(config, db, provider);
  try {
    return chatResponseSchema.parse(
      (await instance.inject({ method: 'POST', url: '/api/chat', payload: request })).json(),
    );
  } finally {
    await instance.close();
  }
}

describe('Navegação independente do RAG médico', () => {
  it('publica catálogo dinâmico e prontidão sem índice médico', async () => {
    expect((await app.inject('/api/ready')).statusCode).toBe(200);
    const meta = await app.inject('/api/catalog');
    expect(meta.json().specialties).toContainEqual({ id: 'urologia', name: 'Urologia' });
    expect(meta.headers['cache-control']).toBe('no-store');
  });
  it('conecta relato, especialidade validada, filtros e textos apenas da clínica selecionada', async () => {
    const body = chatResponseSchema.parse(
      (await app.inject({ method: 'POST', url: '/api/chat', payload })).json(),
    );
    expect(body.specialty).toMatchObject({
      id: 'ortopedia',
    });
    expect(body.clinics.map((c) => c.id)).toEqual(['demo-aldeota']);
    expect(body.sources.every((s) => s.clinicId === 'demo-aldeota')).toBe(true);
    expect(body.ragStatus).toBe('available');
    expect(body.feedback?.token).toHaveLength(64);
  });
  it('usa o histórico recente em respostas curtas', async () => {
    const body = (
      await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: { ...payload, history: [payload.message], message: 'Começou ontem, sem febre' },
      })
    ).json();
    expect(body.specialty.id).toBe('ortopedia');
  });
  it('Urologia funciona sem enum fechado; convênio inexistente não troca a especialidade', async () => {
    const response = await withProvider(
      { ...demoProvider, generate: async () => suggestion() },
      { ...payload, insurance: 'Inexistente' },
    );
    expect(response).toMatchObject({ status: 'no_matching_clinics', clinics: [] });
    expect(response.specialty?.id).toBe('urologia');
  });
  it('não troca a especialidade para preencher resultados vazios', async () => {
    const response = await withProvider({
      ...demoProvider,
      generate: async () => suggestion('Reumatologia'),
    });
    expect(response).toMatchObject({
      status: 'no_matching_clinics',
      clinics: [],
      specialty: { id: 'reumatologia' },
    });
    expect(response).not.toHaveProperty('specialties');
  });
  it('distingue nome desconhecido, referência não cadastrada e falta de contexto', async () => {
    expect(
      (
        await withProvider({
          ...demoProvider,
          generate: async () => suggestion('Especialista em articulações'),
        })
      ).status,
    ).toBe('specialty_unrecognized');
    expect(
      (await withProvider({ ...demoProvider, generate: async () => suggestion('Radiologia') }))
        .status,
    ).toBe('specialty_not_registered');
    const result = await withProvider(demoProvider, { ...payload, message: 'Estou com dor' });
    expect(result).toMatchObject({ status: 'needs_information', specialty: null, clinics: [] });
  });
  it('falha de embeddings não impede indicação e clínicas compatíveis', async () => {
    const response = await withProvider({
      ...demoProvider,
      embed: async () => {
        throw new Error('private-content');
      },
    });
    expect(response).toMatchObject({ mode: 'demo', status: 'ok', ragStatus: 'unavailable' });
    expect(response.clinics[0].id).toBe('demo-aldeota');
    expect(JSON.stringify(response)).not.toContain('private-content');
  });
  it('falha de geração é diferente de saída inválida', async () => {
    expect(
      (
        await withProvider({
          ...demoProvider,
          generate: async () => {
            throw new Error('private-content');
          },
        })
      ).status,
    ).toBe('llm_unavailable');
    expect(
      (
        await withProvider({
          ...demoProvider,
          generate: async () => ({
            ...suggestion(),
            questions: ['pattern', 'location', 'impact'] as Array<
              'pattern' | 'location' | 'impact'
            >,
          }),
        })
      ).status,
    ).toBe('invalid_output');
  });
  it.each([
    'Tome ibuprofeno 400 mg.',
    'Você tem infecção.',
    'Pode ficar tranquilo.',
    'A Clínica Inventada atende seu plano.',
    'Telefone 85999991234.',
  ])('bloqueia saída insegura: %s', async (answer) => {
    expect(
      (await withProvider({ ...demoProvider, generate: async () => ({ ...suggestion(), answer }) }))
        .status,
    ).toBe('invalid_output');
  });
  it('prioriza emergência antes de LLM, embedding, localização ou filtros', async () => {
    const provider = { ...demoProvider, generate: vi.fn(), embed: vi.fn() };
    const response = await withProvider(provider, {
      ...payload,
      message: 'Estou com dor no peito',
    });
    expect(response).toMatchObject({
      mode: 'safety',
      urgency: 'emergency',
      specialty: null,
      clinics: [],
      locationUsed: false,
    });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.embed).not.toHaveBeenCalled();
    expect(response.feedback?.reasons).not.toContain('incorrect_specialty');
  });
  it('restringe o formato a uma especialidade, sem estruturas antigas', () => {
    for (const output of [
      { ...suggestion(), specialty: [suggestion().specialty] },
      { ...suggestion(), specialties: [suggestion().specialty] },
      { ...suggestion(), specialty: { ...suggestion().specialty, priority: 'primary' } },
      { ...suggestion(), answer: 'x'.repeat(1801) },
      { ...suggestion(), sourceIds: ['old-source'] },
    ])
      expect(modelAnswerSchema.safeParse(output).success).toBe(false);
  });
});

describe('Taxonomia e resolução conservadora', () => {
  it('resolve nome e alias com acentos/capitalização, sem fuzzy', async () => {
    const repo = new SpecialtyRepository(db);
    for (const name of ['REUMATOLOGIA', 'Reumatologista', '  reumatologia '])
      expect(await repo.resolve(name)).toMatchObject({
        status: 'resolved',
        specialty: { id: 'reumatologia' },
      });
    expect((await repo.resolve('Especialista em articulações')).status).toBe('unrecognized');
    expect((await repo.resolve('Reumatolgia')).status).toBe('unrecognized');
  });
  it('cadastra nova especialidade e atualiza a API sem recompilar; inativas não são resolvidas', async () => {
    const repo = new SpecialtyRepository(db);
    await repo.import([
      { id: 'geriatria', name: 'Geriatria', aliases: ['Geriatra'], active: true },
    ]);
    expect((await app.inject('/api/catalog')).json().specialties).toContainEqual({
      id: 'geriatria',
      name: 'Geriatria',
    });
    await repo.import([
      { id: 'geriatria', name: 'Geriatria', aliases: ['Geriatra'], active: false },
    ]);
    expect((await repo.resolve('Geriatra')).status).toBe('not_registered');
    await expect(
      repo.import([{ id: 'outro-nome', name: 'Outra área', aliases: ['Urologista'] }]),
    ).rejects.toThrow('alias');
  });
});

describe('Validação e proteção das APIs', () => {
  it('recusa campos extras, entradas fora do limite e origens externas', async () => {
    for (const body of [{ message: 'oi', injectedRole: 'system' }, { message: 'x'.repeat(2001) }])
      expect(
        (await app.inject({ method: 'POST', url: '/api/chat', payload: body })).statusCode,
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
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173'])
      expect(
        (await app.inject({ method: 'POST', url: '/api/chat', payload, headers: { origin } }))
          .statusCode,
      ).toBe(200);
    expect((await app.inject('/api/clinics?page=-1')).statusCode).toBe(400);
    expect((await app.inject('/api/inexistente')).statusCode).toBe(404);
  });
  it('aplica limite no chat', async () => {
    const limited = await buildApp({ ...config, CHAT_RATE_LIMIT: 1 }, db);
    try {
      await limited.inject({ method: 'POST', url: '/api/chat', payload });
      expect((await limited.inject({ method: 'POST', url: '/api/chat', payload })).statusCode).toBe(
        429,
      );
    } finally {
      await limited.close();
    }
  });
  it('exige consentimento OpenAI, mas não para alerta determinístico', async () => {
    const provider = { ...demoProvider, mode: 'openai' as const, generate: vi.fn() };
    const connected = await buildApp(config, db, provider);
    try {
      expect(
        (await connected.inject({ method: 'POST', url: '/api/chat', payload })).statusCode,
      ).toBe(400);
      expect(provider.generate).not.toHaveBeenCalled();
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
