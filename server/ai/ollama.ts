import { z } from 'zod';
import { modelAnswerSchema } from '../../shared/contracts.js';
import type { Config } from '../config.js';
import { careInput, careInstructions } from './prompt.js';
import { vectorLiteral, type AIProvider } from './provider.js';

export class OllamaError extends Error {}

const modelDetails = z.object({
  remote_model: z.string().optional(),
  remote_host: z.string().optional(),
  details: z.object({ format: z.string() }).optional(),
  capabilities: z.array(z.string()).default([]),
});
const chatResult = z.object({
  done: z.literal(true),
  done_reason: z.literal('stop'),
  message: z.object({ role: z.literal('assistant'), content: z.string().min(1).max(16000) }),
});
const embeddingResult = z.object({ embeddings: z.array(z.array(z.number().finite())) });

export function createOllamaProvider(config: Config, transport: typeof fetch = fetch): AIProvider {
  const base = new URL(config.OLLAMA_BASE_URL).origin;

  async function post(
    path: string,
    body: Record<string, unknown>,
    timeout = config.OLLAMA_TIMEOUT_MS,
  ): Promise<unknown> {
    try {
      const response = await transport(`${base}/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status === 404)
        throw new OllamaError(`Modelo local ausente. Execute: ollama pull ${String(body.model)}`);
      if (!response.ok)
        throw new OllamaError(
          'O Ollama não concluiu a solicitação. Confira os modelos instalados e a memória disponível.',
        );
      return await response.json();
    } catch (error) {
      if (error instanceof OllamaError) throw error;
      // Never expose upstream bodies, prompts or identifiers in diagnostics.
      throw new OllamaError(
        'Ollama indisponível ou tempo esgotado. Abra o Ollama e confira http://127.0.0.1:11434.',
      );
    }
  }

  async function requireLocalModel(model: string, capability: 'embedding' | 'completion') {
    // Check each operation before sending text: aliases can point to cloud models.
    const details = modelDetails.safeParse(await post('show', { model }, 10000));
    if (
      !details.success ||
      details.data.remote_model ||
      details.data.remote_host ||
      details.data.details?.format !== 'gguf'
    )
      throw new OllamaError(
        'O MedFinder exige modelos locais GGUF. Modelos remotos/cloud não são permitidos neste modo.',
      );
    if (!details.data.capabilities.includes(capability))
      throw new OllamaError(
        `O modelo ${model} não oferece a capacidade ${capability}. Confira os modelos no .env.`,
      );
  }

  return {
    mode: 'ollama',
    embeddingDimensions: config.OLLAMA_EMBEDDING_DIMENSIONS,
    embeddingModel: `ollama:${config.OLLAMA_EMBEDDING_MODEL}:${config.OLLAMA_EMBEDDING_DIMENSIONS}`,
    async checkAvailability() {
      await requireLocalModel(config.OLLAMA_EMBEDDING_MODEL, 'embedding');
      await requireLocalModel(config.OLLAMA_MODEL, 'completion');
    },
    async embed(texts) {
      if (!texts.length) return [];
      await requireLocalModel(config.OLLAMA_EMBEDDING_MODEL, 'embedding');
      const result = embeddingResult.parse(
        await post('embed', {
          model: config.OLLAMA_EMBEDDING_MODEL,
          input: texts,
          truncate: false,
          keep_alive: '2m',
        }),
      );
      if (result.embeddings.length !== texts.length)
        throw new OllamaError('Lote de embeddings locais incompleto.');
      for (const embedding of result.embeddings)
        vectorLiteral(embedding, config.OLLAMA_EMBEDDING_DIMENSIONS);
      return result.embeddings;
    },
    async generate(input) {
      await requireLocalModel(config.OLLAMA_MODEL, 'completion');
      const sourceIds = input.evidence.map((source) => source.id);
      const groundedSchema = modelAnswerSchema.extend({
        sourceIds: sourceIds.length
          ? z.array(z.enum(sourceIds as [string, ...string[]])).max(4)
          : z.array(z.string()).max(0),
      });
      const format = z.toJSONSchema(groundedSchema);
      const response = chatResult.parse(
        await post('chat', {
          model: config.OLLAMA_MODEL,
          stream: false,
          think: false,
          format,
          messages: [
            {
              role: 'system',
              content: `${careInstructions}
Exemplo apenas de estilo, não use os dados do exemplo como evidência:
Se uma fonte sustenta avaliação inicial em clínica médica para um desconforto persistente,
uma resposta de navegação possível é {"answer":"Uma avaliação em clínica médica pode ajudar a investigar seu desconforto. Conte ao profissional quando começou e o que mudou.","urgency":"routine","specialtyIds":["clinica-medica"],"questions":["Há quanto tempo começou?"],"sourceIds":["id-exato-da-fonte"]}.
Ao responder o caso atual, use somente as fontes recebidas e preserve a incerteza sobre causas e riscos.
Retorne somente JSON conforme este esquema: ${JSON.stringify(format)}`,
            },
            { role: 'user', content: careInput(input) },
          ],
          options: { temperature: 0.2, num_ctx: 8192, num_predict: 900 },
          keep_alive: '2m',
        }),
      );
      return groundedSchema.parse(JSON.parse(response.message.content));
    },
  };
}
