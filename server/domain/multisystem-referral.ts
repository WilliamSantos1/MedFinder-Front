import type { RoutingCandidate } from './specialty-routing.js';
import type { PatientProfile } from './patient.js';
import { normalize } from './text.js';

/**
 * Referral synthesis, not disease identification. For a systemic complaint
 * alongside upper-airway symptoms, an initial general/pediatric evaluation
 * commonly covers the ENT and other mild features together. A single eye
 * keyword must not outweigh the complete presentation. Explicit ocular danger
 * signs are deliberately NOT down-weighted; deterministic safety runs first.
 *
 * This is not an official CDC specialty-ranking algorithm: the cited CDC
 * documents support grouping the symptoms, while referral priority remains
 * a locally testable, conservative navigation policy.
 */
export function rankWholePresentation(
  input: RoutingCandidate[],
  evidence: string,
  patient: PatientProfile,
): RoutingCandidate[] {
  const text = normalize(evidence);
  const upperAirway = /\b(?:coriza|nariz|congestao nasal|rinite|espirros?|garganta|rouquidao|tosse|tossindo)\b/.test(text);
  const systemic = /\b(?:febre|febril|calafrios|indisposicao|mal estar|cansaco|fadiga)\b/.test(text);
  const mildEye = /\b(?:ardencia|ardor|irritacao|olhos? ardendo|cocando|coceira)\b/.test(text) &&
    /\b(?:olhos?|ocular|vista)\b/.test(text);
  const worryingEye = /\b(?:perda de visao|visao emba[cç]ada|visao turva|fotofobia|dor (?:muito )?(?:forte|intensa) (?:no|nos) olhos?|dor ocular intensa|vermelhidao intensa)\b/.test(text);

  // Require independent systemic + airway evidence; anatomical sites alone
  // must never trigger a presumed viral illness or a forced general referral.
  if (!upperAirway || !systemic || worryingEye) return input;

  const adjusted = new Map(input.map((candidate) => [candidate.id, { ...candidate }]));
  const broad = patient.ageYears !== null && patient.ageYears < 18 ? 'pediatria' : 'clinica-medica';
  const highest = Math.max(0, ...input.map((candidate) => candidate.score));
  const broadScore = Math.max(13, highest + 2);
  const broadCurrent = adjusted.get(broad);
  adjusted.set(broad, {
    id: broad,
    score: broadScore,
    reason: [broadCurrent?.reason, 'avaliação inicial de sintomas gerais e respiratórios em conjunto'].filter(Boolean).join(', '),
  });

  // ENT remains a plausible second destination for ongoing nasal/throat issues.
  const ent = adjusted.get('otorrinolaringologia');
  adjusted.set('otorrinolaringologia', {
    id: 'otorrinolaringologia',
    score: Math.max(ent?.score ?? 0, broadScore - 3),
    reason: [ent?.reason, 'predomínio de manifestações nas vias aéreas superiores'].filter(Boolean).join(', '),
  });

  // Eye burning can accompany upper-respiratory illnesses, but this does not
  // exclude independent eye disease. If prominent/serious ocular signs are
  // present, the conservative down-weighting above is disabled.
  if (mildEye) {
    const eye = adjusted.get('oftalmologia');
    if (eye) adjusted.set('oftalmologia', {
      ...eye,
      score: Math.min(eye.score, Math.max(1, broadScore - 7)),
      reason: `${eye.reason}, desconforto ocular leve em quadro com sintomas respiratórios gerais`,
    });
  }

  return [...adjusted.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
