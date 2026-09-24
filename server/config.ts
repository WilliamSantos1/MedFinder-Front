import { loadEnvFile } from 'node:process';
import { z } from 'zod';

try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default(''),
  DATABASE_SSL: boolean.default(false),
  DATA_DIR: z.string().default('./.data/postgres'),
  AI_PROVIDER: z.enum(['demo', 'openai', 'ollama']).default('demo'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().trim().min(1).max(120).default('qwen3:4b-instruct-2507-q4_K_M'),
  OLLAMA_EMBEDDING_MODEL: z.string().trim().min(1).max(120).default('bge-m3'),
  OLLAMA_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(16000).default(1024),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(180000),
  ALLOW_DEMO_DATA: boolean.default(true),
  AUTO_SEED: boolean.default(true),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  CHAT_RATE_LIMIT: z.coerce.number().int().min(1).max(120).default(12),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
});

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = schema.parse(env);
  if (config.AI_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
    throw new Error('AI_PROVIDER=openai exige OPENAI_API_KEY no servidor.');
  }
  if (config.AI_PROVIDER === 'ollama') {
    const url = new URL(config.OLLAMA_BASE_URL);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error(
        'OLLAMA_BASE_URL deve apontar para o Ollama local, por exemplo http://127.0.0.1:11434.',
      );
    for (const model of [config.OLLAMA_MODEL, config.OLLAMA_EMBEDDING_MODEL]) {
      if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(model) || /cloud/i.test(model))
        throw new Error('Use modelos Ollama baixados localmente, sem sufixo cloud.');
    }
  }
  if (config.NODE_ENV === 'production') {
    if (
      !config.DATABASE_URL ||
      config.ALLOW_DEMO_DATA ||
      config.AUTO_SEED ||
      config.AI_PROVIDER === 'demo'
    ) {
      throw new Error(
        'Produção exige PostgreSQL externo, IA generativa, ALLOW_DEMO_DATA=false e AUTO_SEED=false.',
      );
    }
    if (new URL(config.WEB_ORIGIN).protocol !== 'https:')
      throw new Error('WEB_ORIGIN deve usar HTTPS em produção.');
  }
  return config;
}
export type Config = ReturnType<typeof readConfig>;
