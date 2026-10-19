import {
  chatResponseSchema,
  type CatalogMeta,
  type ChatRequest,
  clinicResultsSchema,
  type FeedbackRequest,
} from '../../shared/contracts';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Não foi possível conectar. Tente novamente.');
  }
  return response.json() as Promise<T>;
}

export const api = {
  catalog: (signal: AbortSignal) => request<CatalogMeta>('/catalog', { signal }),
  clinics: async (body: string, signal: AbortSignal) =>
    clinicResultsSchema.parse(await request('/clinics/search', { method: 'POST', body, signal })),
  feedback: (body: FeedbackRequest) =>
    request<{ status: 'saved' }>('/feedback', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    }),
  chat: async (body: ChatRequest, signal: AbortSignal) =>
    chatResponseSchema.parse(
      await request('/chat', { method: 'POST', body: JSON.stringify(body), signal }),
    ),
};
