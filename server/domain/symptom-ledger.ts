import { normalize } from './text.js';

export type SymptomStatus = 'active' | 'resolved' | 'denied';
export interface SymptomFact { key: string; status: SymptomStatus }

type Signal = { key: string; pattern: RegExp; mask: RegExp };

/**
 * Explicit clinical facts rather than a sticky specialty ID. These are broad
 * navigation features, not diagnoses. The LLM still interprets unfamiliar
 * descriptions. Negated/resolved features are excluded ONLY from specialty
 * scoring; the safety assessment always sees the original transcript.
 */
const signals: Signal[] = [
  { key: 'coriza', pattern: /\b(?:coriza|nariz escorrendo|nariz pingando|secrecao nasal)\b/, mask: /\b(?:coriza|nariz escorrendo|nariz pingando|secrecao nasal)\b/g },
  { key: 'congestao-nasal', pattern: /\b(?:nariz (?:entupido|congestionado)|congestao nasal|nariz trancado|obstrucao nasal)\b/, mask: /\b(?:nariz (?:entupido|congestionado)|congestao nasal|nariz trancado|obstrucao nasal)\b/g },
  { key: 'febre', pattern: /\b(?:febre|febril|temperatura alta)\b/, mask: /\b(?:febre|febril|temperatura alta)\b/g },
  { key: 'indisposicao', pattern: /\b(?:indisposicao|mal estar|cansaco|fadiga)\b/, mask: /\b(?:indisposicao|mal estar|cansaco|fadiga)\b/g },
  { key: 'irritacao-ocular', pattern: /\b(?:ardencia (?:nos? )?olhos?|ardor (?:nos? )?olhos?|olhos? ardendo|queimacao (?:nos? )?olhos?|irritacao ocular|ardencia ocular|olhos? irritad[oa]s?)\b/, mask: /\b(?:ardencia (?:nos? )?olhos?|ardor (?:nos? )?olhos?|olhos? ardendo|queimacao (?:nos? )?olhos?|irritacao ocular|ardencia ocular|olhos? irritad[oa]s?)\b/g },
  { key: 'dor-ocular', pattern: /\b(?:dor (?:nos? )?olhos?|dor ocular|olhos? doendo|dor na vista)\b/, mask: /\b(?:dor (?:nos? )?olhos?|dor ocular|olhos? doendo|dor na vista)\b/g },
  { key: 'vermelhidao-ocular', pattern: /\b(?:olhos? (?:vermelhos?|avermelhad[oa]s?)|vermelhidao ocular|olhos? injetados?)\b/, mask: /\b(?:olhos? (?:vermelhos?|avermelhad[oa]s?)|vermelhidao ocular|olhos? injetados?)\b/g },
  { key: 'alteracao-visual', pattern: /\b(?:visao emba[cç]ada|perda (?:da|de) visao|nao consigo enxergar|fotofobia|sensibilidade a luz)\b/, mask: /\b(?:visao embacada|perda (?:da|de) visao|nao consigo enxergar|fotofobia|sensibilidade a luz)\b/g },
  { key: 'tosse', pattern: /\b(?:tosse|tossindo|tossir)\b/, mask: /\b(?:tosse|tossindo|tossir)\b/g },
  { key: 'garganta', pattern: /\b(?:dor de garganta|garganta (?:doendo|inflamada)|amigdalas? (?:doendo|inflamadas?))\b/, mask: /\b(?:dor de garganta|garganta (?:doendo|inflamada)|amigdalas? (?:doendo|inflamadas?))\b/g },
  { key: 'falta-de-ar', pattern: /\b(?:falta de ar|dificuldade para respirar|respiracao dificil)\b/, mask: /\b(?:falta de ar|dificuldade para respirar|respiracao dificil)\b/g },
  { key: 'dor-muscular', pattern: /\b(?:dor (?:no|na|nos|nas) (?:pe|pes|perna|pernas|braco|bracos|quadril|joelho|ombro|costas|coluna|triceps|biceps)|dor muscular)\b/, mask: /\b(?:dor (?:no|na|nos|nas) (?:pe|pes|perna|pernas|braco|bracos|quadril|joelho|ombro|costas|coluna|triceps|biceps)|dor muscular)\b/g },
  { key: 'diarreia', pattern: /\b(?:diarreia|disenteria|desinteria|fezes liquidas|intestino solto)\b/, mask: /\b(?:diarreia|disenteria|desinteria|fezes liquidas|intestino solto)\b/g },
  { key: 'vomito', pattern: /\b(?:vomito|vomitando|nausea|enjoo)\b/, mask: /\b(?:vomito|vomitando|nausea|enjoo)\b/g },
  { key: 'ardencia-urinar', pattern: /\b(?:ardencia (?:ao|para) urinar|dor ao urinar|urina ardendo)\b/, mask: /\b(?:ardencia (?:ao|para) urinar|dor ao urinar|urina ardendo)\b/g },
  { key: 'tontura', pattern: /\b(?:tontura|vertigem|desequilibrio)\b/, mask: /\b(?:tontura|vertigem|desequilibrio)\b/g },
  { key: 'coceira', pattern: /\b(?:coceira|prurido|cocando)\b/, mask: /\b(?:coceira|prurido|cocando)\b/g },
  { key: 'manchas-pele', pattern: /\b(?:manchas? na pele|erupcao na pele|lesao de pele)\b/, mask: /\b(?:manchas? na pele|erupcao na pele|lesao de pele)\b/g },
];

const resolves = /\b(?:passou|passaram|sumiu|sumiram|cessou|cessaram|acabou|acabaram|desapareceu|desapareceram|resolveu|resolvida|resolvido)\b/;
const noLonger = /\b(?:nao (?:tenho|sinto|esta|estou|apresento|percebo) mais|nao ha mais|sem mais|deixou de|parou de)\b/;
const onlyNow = /\b(?:agora|atualmente|nesse momento|neste momento|hoje)\s+(?:so|somente|apenas|restou|resta)\b|\b(?:so|somente|apenas)\s+(?:tenho|sinto|estou com|ficou|resta|restou)\b/;

function statusInClause(clause: string, match: RegExpMatchArray): SymptomStatus {
  const before = clause.slice(Math.max(0, match.index! - 40), match.index!);
  const after = clause.slice(match.index! + match[0].length, match.index! + match[0].length + 40);
  // "a ardência nos olhos passou", "não sinto mais ardência"
  if (resolves.test(after) || /\b(?:passou|sumiu|acabou|cessou|desapareceu)\b(?:\s+\w+){0,2}\s*$/.test(before) || noLonger.test(before) || noLonger.test(after)) return 'resolved';
  if (/\b(?:nao tenho mais|nao sinto mais|sem mais)\b/.test(before)) return 'resolved';
  if (/\b(?:sem|nao tenho|nao sinto|nao apresenta|nenhum|nenhuma)\s+(?:\w+\s+){0,3}$/.test(before)) return 'denied';
  return 'active';
}

/** Apply one patient utterance to facts from the SAME clinical episode. */
export function updateSymptomLedger(previous: SymptomFact[], message: string): SymptomFact[] {
  const updated = new Map(previous.map(({key, status}) => [key, status]));
  const normalized = normalize(message);
  const clauses = normalized.split(/[,;.!?\n]|\b(?:mas|porem|agora|atualmente)\b/).filter(Boolean);
  const mentioned = new Set<string>();

  for (const clause of clauses) {
    for (const signal of signals) {
      const match = clause.match(signal.pattern);
      if (!match) continue;
      const status = statusInClause(clause, match);
      updated.set(signal.key, status);
      if (status === 'active') mentioned.add(signal.key);
    }
  }
  // Global "agora só coriza" means other previously recorded symptoms no longer
  // belong to the CURRENT complaint. Never use this to clear deterministic safety.
  if (onlyNow.test(normalized) && mentioned.size) {
    for (const [key, status] of updated) {
      if (status === 'active' && !mentioned.has(key)) updated.set(key, 'resolved');
    }
  }
  return [...updated].slice(-32).map(([key, status]) => ({ key, status }));
}

export function symptomLedgerFromMessages(messages: string[]): SymptomFact[] {
  return messages.reduce((facts, message) => updateSymptomLedger(facts, message), [] as SymptomFact[]);
}

/** Mask no-longer-present features across previous turns for referral scoring. */
export function currentReferralEvidence(messages: string[], facts: SymptomFact[]): string {
  let text = messages.map(normalize).join('\n');
  for (const fact of facts) {
    if (fact.status === 'active') continue;
    const signal = signals.find((item) => item.key === fact.key);
    if (signal) text = text.replace(signal.mask, ' ');
  }
  // Avoid a remaining bare "olhos" from an earlier, fully resolved irritation
  // defeating the systemic/airway assessment. Do not erase an active ocular sign.
  const eyeKeys = ['irritacao-ocular', 'dor-ocular', 'vermelhidao-ocular', 'alteracao-visual'];
  if (facts.some((fact) => eyeKeys.includes(fact.key) && fact.status === 'resolved') &&
      !facts.some((fact) => eyeKeys.includes(fact.key) && fact.status === 'active')) {
    text = text.replace(/\b(?:olhos?|ocular|visao|vista)\b/g, ' ');
  }
  return text;
}
