import type { Config } from '../config.js';
import { demoProvider } from './demo.js';
import { createOpenAIProvider } from './openai.js';
import { createOllamaProvider } from './ollama.js';
import type { AIProvider } from './provider.js';

export function createProvider(config: Config): AIProvider {
  if (config.AI_PROVIDER === 'ollama') return createOllamaProvider(config);
  if (config.AI_PROVIDER === 'openai') return createOpenAIProvider(config);
  return demoProvider;
}
