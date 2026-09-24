import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { chatRequestSchema, clinicFiltersSchema } from '../shared/contracts.js';
import type { AIProvider } from './ai/provider.js';
import { createProvider } from './ai/factory.js';
import type { Config } from './config.js';
import { CatalogRepository } from './db/catalog.js';
import type { Database } from './db/database.js';
import { Retriever } from './rag/retrieve.js';
import { ChatService } from './services/chat.js';
import { detectUrgency } from './domain/safety.js';
import { catalogStatus } from './services/readiness.js';

function allowedWebOrigins(config: Config) {
  const configured = new URL(config.WEB_ORIGIN);
  if (
    !['http:', 'https:'].includes(configured.protocol) ||
    configured.username ||
    configured.password ||
    configured.pathname !== '/' ||
    configured.search ||
    configured.hash
  )
    throw new Error(
      'WEB_ORIGIN deve conter somente protocolo, endereço e porta, por exemplo http://localhost:5173.',
    );

  // Browsers serialize Origin without a trailing slash. Keep protocol and port
  // exact, accepting loopback aliases only in local development/test.
  const origins = new Set([configured.origin]);
  const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];
  if (config.NODE_ENV !== 'production' && loopbackHosts.includes(configured.hostname)) {
    for (const hostname of loopbackHosts) {
      const alias = new URL(configured.origin);
      alias.hostname = hostname;
      origins.add(alias.origin);
    }
  }
  return origins;
}

export async function buildApp(
  config: Config,
  db: Database,
  provider: AIProvider = createProvider(config),
) {
  const webOrigins = allowedWebOrigins(config);
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 24000,
    requestTimeout: 60000,
    trustProxy: config.TRUST_PROXY_HOPS ? (_address, hop) => hop < config.TRUST_PROXY_HOPS : false,
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
      },
    },
  });
  await app.register(cors, {
    origin: [...webOrigins],
    methods: ['GET', 'POST'],
    credentials: false,
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const catalog = new CatalogRepository(db, config.ALLOW_DEMO_DATA);
  const chat = new ChatService(
    new Retriever(db, provider, config.ALLOW_DEMO_DATA),
    provider,
    catalog,
    config.AI_MAX_CONCURRENCY,
    () => app.log.warn({ event: 'ai_unavailable' }, 'Consulta de IA indisponível'),
  );

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (
      request.method === 'POST' &&
      request.headers.origin &&
      !webOrigins.has(request.headers.origin)
    ) {
      return reply.code(403).send({
        error:
          config.NODE_ENV === 'production'
            ? 'Origem não permitida.'
            : `Origem não permitida. Abra o MedFinder em ${new URL(config.WEB_ORIGIN).origin}.`,
      });
    }
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async (_request, reply) => {
    try {
      await db.query('SELECT 1');
      const status = await catalogStatus(db, config, provider);
      const ready =
        status.knowledge.indexedDocuments > 0 &&
        !status.knowledge.needsReindex &&
        status.directory.total > 0;
      return reply.code(ready ? 200 : 503).send({
        status: ready
          ? 'ready'
          : status.knowledge.needsReindex
            ? 'reindex_required'
            : !status.knowledge.indexedDocuments
              ? 'knowledge_unavailable'
              : 'catalog_unavailable',
      });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.get('/api/catalog', async () => catalogStatus(db, config, provider));
  app.get('/api/clinics', async (request) =>
    catalog.search(clinicFiltersSchema.parse(request.query)),
  );
  app.post(
    '/api/chat',
    { config: { rateLimit: { max: config.CHAT_RATE_LIMIT, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = chatRequestSchema.parse(request.body);
      if (
        provider.mode === 'openai' &&
        !body.consent &&
        !detectUrgency([...body.history, body.message])
      ) {
        return reply.code(400).send({ error: 'Autorize o envio à OpenAI antes de continuar.' });
      }
      return chat.answer(body);
    },
  );
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Revise os campos enviados. A mensagem deve ter entre 3 e 2.000 caracteres.',
      });
    const statusCode =
      error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode < 500) {
      const message =
        statusCode === 429
          ? 'Muitas solicitações. Aguarde um minuto e tente novamente.'
          : 'Não foi possível processar a solicitação.';
      return reply.code(statusCode).send({ error: message });
    }
    app.log.error({ event: 'request_failed' }, 'Falha interna na solicitação');
    return reply.code(500).send({ error: 'Serviço indisponível. Tente novamente em instantes.' });
  });

  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.includes('.') || request.method !== 'GET')
        return reply.code(404).send({ error: 'Recurso não encontrado.' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: 'Recurso não encontrado.' }),
    );
  return app;
}
