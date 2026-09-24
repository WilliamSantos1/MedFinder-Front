import {
  chatResponseSchema,
  type CatalogMeta,
  type ChatRequest,
  type ClinicResults,
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
  clinics: (query: string, signal: AbortSignal) =>
    request<ClinicResults>(`/clinics?${query}`, { signal }),
  chat: async (body: ChatRequest, signal: AbortSignal) =>
    chatResponseSchema.parse(
      await request('/chat', { method: 'POST', body: JSON.stringify(body), signal }),
    ),
};
