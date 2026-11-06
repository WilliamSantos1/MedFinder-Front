import { performance } from 'node:perf_hooks';

const base = (process.env.MEDFINDER_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

const cases = [
  { message: 'bom dia, meu olho está avermelhado e coçando', expected: 'oftalmologia' },
  { message: 'dor no joelho depois de correr e piora ao caminhar', expected: 'ortopedia' },
  { message: 'tenho refluxo e azia', expected: 'gastroenterologia' },
  { message: 'meu filho de 8 anos está com coriza desde ontem', expected: 'pediatria' },
  { message: 'estou com tontura', expectedAny: ['neurologia', 'otorrinolaringologia', 'clinica-medica'] },
  { message: 'estou com rinite', expectedAny: ['otorrinolaringologia', 'alergologia-imunologia', 'clinica-medica'] },
  { message: 'tenho uma síndrome rara e não sei qual médico procurar', expectedAny: ['clinica-medica'] },
] as const;

const rows: Array<Record<string, unknown>> = [];
for (const item of cases) {
  const started = performance.now();
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({
      message: item.message,
      history: [],
      city: '',
      insurance: '',
      consent: false,
    }),
  });
  const elapsedMs = performance.now() - started;
  const payload = (await response.json()) as {
    specialty?: { id?: string } | null;
    mode?: string;
    status?: string;
    ragStatus?: string;
  };
  const actual = payload.specialty?.id ?? null;
  const allowed = 'expected' in item ? [item.expected] : [...item.expectedAny];
  rows.push({
    message: item.message,
    http: response.status,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    mode: payload.mode,
    specialty: actual,
    expected: allowed,
    acceptable: actual !== null && allowed.includes(actual as never),
    status: payload.status,
    ragStatus: payload.ragStatus,
  });
}

console.table(rows);
const times = rows.map((row) => Number(row.elapsedMs)).sort((a, b) => a - b);
const percentile = (p: number) => times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)];
console.log(
  JSON.stringify(
    {
      cases: rows.length,
      acceptable: rows.filter((row) => row.acceptable).length,
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      note: 'Benchmark end-to-end do backend já em execução; inclui SQL/RAG e Ollama quando o fluxo exige.',
    },
    null,
    2,
  ),
);
