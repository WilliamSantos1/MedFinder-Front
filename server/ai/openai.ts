import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { modelAnswerSchema } from '../../shared/contracts.js';
import type { Config } from '../config.js';
import { careInstructions, careInput } from './prompt.js';
import { EMBEDDING_DIMENSIONS, type AIProvider } from './provider.js';

export function createOpenAIProvider(config: Config, transport?: typeof fetch): AIProvider {
  const client = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    timeout: 25000,
    maxRetries: 0,
    fetch: transport,
  });
  return {
    mode: 'openai',
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embeddingModel: `${config.EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`,
    async embed(texts) {
      const response = await client.embeddings.create({
        model: config.EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      });
      const embeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
      if (embeddings.length !== texts.length) throw new Error('Lote de embeddings incompleto.');
      return embeddings;
    },
    async generate(input) {
      const response = await client.responses.parse({
        model: config.OPENAI_MODEL,
        store: false,
        instructions: careInstructions,
        input: [
          {
            role: 'user',
            content: careInput(input),
          },
        ],
        max_output_tokens: 900,
        text: { format: zodTextFormat(modelAnswerSchema, 'care_navigation') },
      });
      if (!response.output_parsed || response.status !== 'completed')
        throw new Error('Resposta indisponível ou recusada.');
      return response.output_parsed;
    },
  };
}
