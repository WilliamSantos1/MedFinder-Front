import type { PatientProfile } from './patient.js';
import { normalize } from './text.js';

/**
 * Conservative fallback used only when the LLM cannot provide a valid candidate.
 * It maps an explicit body system/complaint to a broad evaluation area; it never
 * diagnoses a condition and never overrides deterministic urgency rules.
 */
export function fallbackSpecialtyId(messages: string[], patient: PatientProfile) {
  const text = normalize(messages.join(' '));
  if (/\b(olhos?|visao|ocular)\b/.test(text)) return 'oftalmologia';
  if (/\b(ouvido|audicao|nariz|coriza|rinite|congestao nasal|garganta|rouquidao|amigdal)\b/.test(text))
    return patient.ageYears !== null && patient.ageYears < 18 ? 'pediatria' : 'otorrinolaringologia';
  if (/\b(pele|coceira|cocando|manchas?|erupcao|urticaria)\b/.test(text))
    return patient.ageYears !== null && patient.ageYears < 18 ? 'pediatria' : 'dermatologia';
  if (/\b(joelho|ombro|braco|perna|tornozelo|coluna|lombar|pescoco|articulacao)\b/.test(text))
    return 'ortopedia';
  if (/\b(urina|urinar|urinaria|bexiga|prostata|penis)\b/.test(text)) return 'urologia';
  if (/\b(estomago|abdomen|abdominal|intestino|digest)\b/.test(text)) return 'gastroenterologia';
  if (/\b(tosse|catarro|chiado|pulmao|respiratorio)\b/.test(text)) return 'pneumologia';
  return null;
}
