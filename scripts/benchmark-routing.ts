import { performance } from 'node:perf_hooks';
import { patientProfile } from '../server/domain/patient.js';
import { routeComplaint } from '../server/domain/specialty-routing.js';

const cases = [
  'meu olho está avermelhado e coçando',
  'estou com dor no joelho depois de correr',
  'tenho enxaqueca',
  'estou com palpitações',
  'estou com refluxo e azia',
  'estou com coriza e nariz entupido',
  'minha filha de 8 anos está com coriza',
  'tenho manchas e coceira na pele',
  'sinto ardência ao urinar',
  'tenho zumbido no ouvido',
  'estou com tontura',
  'tenho um caroço no pescoço',
  'meu exame de tireoide veio alterado',
  'tenho varizes nas pernas',
  'estou com febre e cansaço',
  'estou com um problema de saúde raro que não sei explicar',
];

const rounds = 5_000;
const started = performance.now();
let deterministic = 0;
let semantic = 0;
let clarification = 0;
for (let index = 0; index < rounds; index++) {
  const message = cases[index % cases.length];
  const route = routeComplaint([message], patientProfile([message]));
  deterministic += Number(Boolean(route.deterministicId));
  semantic += Number(route.healthComplaint && !route.deterministicId && !route.needsClarification);
  clarification += Number(route.needsClarification);
}
const elapsedMs = performance.now() - started;
console.log(
  JSON.stringify(
    {
      evaluations: rounds,
      totalMs: Number(elapsedMs.toFixed(2)),
      averageMs: Number((elapsedMs / rounds).toFixed(4)),
      deterministic,
      semantic,
      clarification,
      note: 'Mede apenas o roteador local; não inclui banco, embeddings, RAG ou Ollama.',
    },
    null,
    2,
  ),
);
