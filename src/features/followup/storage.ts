import { z } from 'zod';
import { idSchema, type ChatResponse } from '../../../shared/contracts';

const KEY = 'medfinder.followup.v1';
export const MIN_ABSENCE_MS = 5 * 1000; // quanto tempo fora conta como "voltou depois de um tempo"
const MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000; // o comprovante do servidor expira em 7 dias
const MAX_ITEMS = 5;

const itemSchema = z.object({
  responseId: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  shownAt: z.number(),
  clinics: z
    .array(z.object({ id: idSchema, name: z.string().max(120) }))
    .min(1)
    .max(3),
});
const stateSchema = z.object({ lastSeen: z.number(), items: z.array(itemSchema).max(MAX_ITEMS) });
export type FollowUpItem = z.infer<typeof itemSchema>;
type State = z.infer<typeof stateSchema>;

const empty = (): State => ({ lastSeen: 0, items: [] });

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? stateSchema.safeParse(JSON.parse(raw)) : null;
    if (!parsed?.success) return empty();
    const now = Date.now();
    return {
      lastSeen: parsed.data.lastSeen,
      items: parsed.data.items.filter((item) => now - item.shownAt < MAX_AGE_MS),
    };
  } catch {
    return empty();
  }
}

function write(state: State) {
  try {
    if (state.items.length) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    // Armazenamento indisponível (modo privado, cota): o recurso apenas deixa de funcionar.
  }
}

/** Chamado quando o chat indica clínicas. Só então algo é gravado no navegador. */
export function rememberRecommendation(response: ChatResponse) {
  if (!response.feedback || !response.clinics.length) return;
  if (response.urgency === 'emergency' || response.urgency === 'prompt') return;
  const state = read();
  const item: FollowUpItem = {
    responseId: response.id,
    token: response.feedback.token,
    shownAt: Date.now(),
    clinics: response.clinics.map(({ id, name }) => ({ id, name })),
  };
  write({ lastSeen: Date.now(), items: [item, ...state.items].slice(0, MAX_ITEMS) });
}

/** Atualiza "visto por último" somente se houver indicações aguardando retorno. */
export function touchLastSeen() {
  const state = read();
  if (state.items.length) write({ ...state, lastSeen: Date.now() });
}

export function dueItems(now = Date.now()): FollowUpItem[] {
  const state = read();
  if (!state.items.length || !state.lastSeen || now - state.lastSeen < MIN_ABSENCE_MS) return [];
  return state.items;
}

export function discardItems(responseIds: string[]) {
  const state = read();
  write({ ...state, items: state.items.filter((item) => !responseIds.includes(item.responseId)) });
}
