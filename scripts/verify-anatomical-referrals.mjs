/**
 * Compile first: npm.cmd run build
 * Offline routing regression. It does NOT simulate a clinician or test Qwen.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeComplaint } from '../build/server/domain/specialty-routing.js';
import { patientProfile } from '../build/server/domain/patient.js';
import { detectUrgency } from '../build/server/domain/safety.js';
import { assessAnatomicalDifferential } from '../build/server/domain/anatomical-differential.js';
import { matchClinicalCases, CASEBOOK_COUNT } from '../build/server/domain/clinical-casebook.js';
import { isSupportedReferral } from '../build/server/domain/referral-validation.js';
import { careInput } from '../build/server/ai/prompt.js';

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const route = (messages) => {
  const input = Array.isArray(messages) ? messages : [messages];
  const p = patientProfile(input);
  return { p, r: routeComplaint(input, p) };
};

// Re-run every historical regression case from the same project's corpus.
const legacy = JSON.parse(readFileSync(new URL('../data/routing-regression-cases.json', import.meta.url)));
for (const item of legacy) {
  const { r } = route(item.message);
  check(r.healthComplaint, `historical complaint undetected: ${item.message}`);
  if (item.type === 'deterministic') check(r.deterministicId === item.expected,
    `historical deterministic ${item.message}: expected ${item.expected}, got ${r.deterministicId}`);
  if (item.type === 'candidate') {
    check(r.deterministicId === null, `historical ambiguous deterministic: ${item.message}`);
    for (const id of item.expectedAny ?? []) check(r.candidates.some(c => c.id === id), `historical candidate ${id}: ${item.message}`);
  }
  if (item.type === 'clarification') {
    check(r.deterministicId === null, `historical clarification overridden: ${item.message}`);
    for (const topic of item.expectedTopics ?? []) check(r.clarificationTopics.includes(topic), `historical missing ${topic}: ${item.message}`);
  }
  if (item.type === 'semantic-fallback') {
    check(r.deterministicId === null, `historical semantic fallback overridden: ${item.message}`);
    check(r.fallbackId === item.expectedFallback, `historical fallback: ${item.message}`);
  }
}

const ambiguous = [
  'Meu pai sente dor na região do púbis.',
  'Estou com dor no púbis desde ontem.',
  'Minha mãe tem desconforto na região pélvica.',
  'Estou com dor na virilha.',
  'Tenho dor no baixo ventre.',
  'Dor na região suprapúbica.',
  'Tenho dor na axila.',
  'A axila está dolorida.',
  'Sinto dor no flanco.',
  'Dor no lado da barriga.',
  'Sinto dor na mandíbula.',
  'Meu maxilar está doendo.',
];
for (const message of ambiguous) {
  const { r, p } = route(message);
  const anatomy = assessAnatomicalDifferential(message);
  check(anatomy.unresolved, `missing cross-system ambiguity: ${message}`);
  check(r.needsClarification && !r.deterministicId, `premature specialty for ${message}`);
  check(r.candidates[0]?.id === r.fallbackId, `broad first routing expected: ${message}`);
  for (const wrong of ['urologia', 'ginecologia', 'dermatologia', 'ortopedia']) {
    check(!isSupportedReferral(wrong, r, p), `false specialty ${wrong}: ${message}`);
  }
}

const contextual = [
  ['Dor no púbis e ardência ao urinar desde ontem.', 'urologia'],
  ['Dor na região púbica depois de correr na academia.', 'ortopedia'],
  ['Dor na virilha depois de musculação.', 'ortopedia'],
  ['Dor na virilha e abaulamento local.', 'cirurgia-geral'],
  ['Dor no baixo ventre com cólica menstrual.', 'ginecologia'],
  ['Dor na região pélvica e corrimento vaginal.', 'ginecologia'],
  ['Dor no púbis, com diarreia desde ontem.', 'clinica-medica'],
  ['Bolinhas avermelhadas e coceira na axila.', 'dermatologia'],
  ['Dor na axila depois de academia e esforço.', 'ortopedia'],
  ['Um caroço na axila que me incomoda.', 'clinica-medica'],
  ['Dor no flanco, com sangue na urina.', 'clinica-medica'],
  ['Dor no flanco após esforço na academia.', 'ortopedia'],
  ['Bolinhas vermelhas na glande.', 'dermatologia'],
  ['Dor no ombro após levantar televisão.', 'ortopedia'],
  ['Dor e inchaço na unha após prensamento.', 'ortopedia'],
  ['Coriza, febre e ardência nos olhos.', 'clinica-medica'],
  ['Meu olho está vermelho e coçando.', 'oftalmologia'],
  ['Meu avô de 78 anos tem fragilidade e quedas recorrentes.', 'geriatria'],
  ['Meu filho de 8 anos está com dor nas amígdalas.', 'pediatria'],
];
for (const [message, expected] of contextual) {
  const { r } = route(message);
  check(r.candidates[0]?.id === expected,
    `contextual routing ${message}: expected ${expected}, got ${r.candidates.map(c => `${c.id}:${c.score}`).join(', ')}`);
}

const urgent = [
  ['Meu pai está com dor forte no púbis desde ontem.', 'emergency'],
  ['É uma dor muito forte no púbis, começou ontem.', 'emergency'],
  ['Púbis dolorido, uma dor insuportável desde a madrugada.', 'emergency'],
  ['Dor na virilha, apareceu abaulamento e estou vomitando.', 'emergency'],
  ['Dor na pelve com febre alta desde hoje.', 'prompt'],
  ['Estou grávida e tenho dor pélvica desde hoje.', 'prompt'],
  ['Pálpebras inchadas e vermelhas. Às vezes dói.', 'prompt'],
  ['Tenho dor forte no olho e visão embaçada.', 'prompt'],
  ['Minha perna está dolorida e inchada só de um lado.', 'prompt'],
  ['Não consigo respirar.', 'emergency'],
  ['Dor forte no peito.', 'emergency'],
  ['Tenho dor no testículo, súbita e intensa.', 'emergency'],
];
for (const [message, expected] of urgent) check(detectUrgency([message]) === expected,
  `urgent mismatch ${message}: expected ${expected}, got ${detectUrgency([message])}`);
const nonurgent = [
  'Tenho dor leve no púbis, sem outros sintomas.',
  'Não tenho dor forte no púbis, apenas desconforto.',
  'Estou com dor na virilha, mas sem inchaço nem febre.',
  'Dor no flanco sem febre.',
  'Tenho coriza e febre baixa, sem falta de ar.',
];
for (const message of nonurgent) check(detectUrgency([message]) === null,
  `false urgency: ${message}: ${detectUrgency([message])}`);
check(detectUrgency(['Meu pai está com dor no púbis.', 'É uma dor forte, constante desde ontem.']) === 'emergency',
  'patient episode urgency must combine separate turns');
check(detectUrgency(['Meu pai está com dor no púbis.', 'Começou ontem, sem febre e não é uma dor forte.']) === null,
  'negated severity cannot create an emergency');

check(CASEBOOK_COUNT >= 85, `Expected at least 85 scenarios, got ${CASEBOOK_COUNT}`);
const prompt = JSON.parse(careInput({ message: 'Sinto dor no púbis.', history: [], specialties: [] }));
check(prompt.anatomicalDifferentialHint?.[0]?.region.includes('púbis'), 'LLM lacks anatomical-differential hint');
check(prompt.anatomicalDifferentialHint?.[0]?.possibleSpecialties.includes('ortopedia'), 'LLM lacks plausible alternative');
check(matchClinicalCases('Dor no púbis e ardência ao urinar.', patientProfile(['Dor no púbis e ardência ao urinar.'])).some(c => c.id === 'pubic-urinary-symptoms'), 'Missing evidence-based urinary scenario');

console.log(`Anatomical referral audit: ${CASEBOOK_COUNT} casebook scenarios, ${checks} direct checks passed.`);
