import { describe, expect, it } from 'vitest';
import { createOpenAIProvider } from '../server/ai/openai.js';
import { readConfig } from '../server/config.js';
import type { Evidence } from '../server/ai/provider.js';

const config = readConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only-not-a-real-key' });
const evidence: Evidence = {
  id: 'doc:1',
  title: 'Avaliação inicial',
  url: 'https://example.org/source',
  publisher: 'Fixture',
  excerpt: 'Clínica médica',
  content: 'Clínica médica pode iniciar a avaliação.',
  reviewStatus: 'approved',
  score: 0.8,
  specialties: ['clinica-medica'],
};

describe('Contrato HTTP do adaptador OpenAI (sem chamadas pagas)', () => {
  it('envia parâmetros de embedding e ordena vetores pelo índice', async () => {
    let sent: Record<string, unknown> = {};
    const provider = createOpenAIProvider(config, async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { object: 'embedding', index: 1, embedding: [0, 1] },
            { object: 'embedding', index: 0, embedding: [1, 0] },
          ],
          model: config.EMBEDDING_MODEL,
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    expect(await provider.embed(['primeiro', 'segundo'])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(sent).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: 1536,
      encoding_format: 'float',
    });
  });
  it('usa Responses API estruturada com store=false e contexto delimitado', async () => {
    const answer = {
      answer: 'Clínica médica pode iniciar a avaliação.',
      urgency: 'routine',
      specialtyIds: ['clinica-medica'],
      questions: [],
      sourceIds: ['doc:1'],
    };
    let sent: Record<string, unknown> = {};
    const provider = createOpenAIProvider(config, async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: 'resp_test',
          object: 'response',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_test',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify(answer),
                  annotations: [],
                  logprobs: [],
                },
              ],
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    expect(
      await provider.generate({ message: 'dor no pescoço', history: [], evidence: [evidence] }),
    ).toEqual(answer);
    expect(sent.store).toBe(false);
    expect(sent.text).toMatchObject({ format: { type: 'json_schema', strict: true } });
    expect(JSON.stringify(sent.input)).toContain('retrievedEvidence');
  });
  it('recusa resposta incompleta ou recusada pelo provedor', async () => {
    const provider = createOpenAIProvider(
      config,
      async () =>
        new Response(
          JSON.stringify({
            id: 'resp_test',
            object: 'response',
            status: 'completed',
            output: [
              {
                type: 'message',
                id: 'msg_test',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'refusal', refusal: 'Cannot answer' }],
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      provider.generate({ message: 'relato', history: [], evidence: [evidence] }),
    ).rejects.toThrow();
  });
});
