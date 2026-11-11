import type { ComplaintRouting } from './specialty-routing.js';
import type { PatientProfile } from './patient.js';

/**
 * Independent, fail-closed validation for a model-suggested first-referral specialty.
 *
 * The language model is free to INTERPRET the complaint and choose useful
 * interview topics from the first turn. It is not free to turn any existing
 * specialty name into a clinic recommendation. An organ-specific specialty
 * needs independent evidence in the current patient's complaint.
 *
 * This checks navigation support, NOT a diagnosis. It deliberately does not
 * pretend to know the cause of a symptom. An unfamiliar complaint is referred
 * to a general entry point until sufficient independent support exists.
 */
export function supportedReferralIds(
  routing: ComplaintRouting,
  patient: PatientProfile,
): string[] {
  const topScore = routing.candidates[0]?.score ?? 0;
  // Retain multiple genuinely plausible areas (e.g. ENT and general care
  // for congestion; ENT and Neurology for dizziness), not every weak match.
  // With no lexical evidence there is no trustworthy specific shortlist.
  const minimum = Math.max(4, topScore - 5);
  const supported = routing.candidates
    .filter((candidate) => candidate.score >= minimum)
    .map((candidate) => candidate.id);

  // Broad care is always a permissible first destination. In children,
  // Pediatrics is the normal broad entry point, without inferring age from
  // the caregiver or a different patient's earlier messages.
  const broad = patient.ageYears !== null && patient.ageYears < 18
    ? 'pediatria'
    : 'clinica-medica';
  if (!supported.includes(broad)) supported.push(broad);

  // Unknown-age patients and adults must not inherit Pediatrics.
  if (patient.ageYears === null || patient.ageYears >= 18) {
    return supported.filter((id) => id !== 'pediatria');
  }
  return supported;
}

export function isSupportedReferral(
  specialtyId: string,
  routing: ComplaintRouting,
  patient: PatientProfile,
): boolean {
  return supportedReferralIds(routing, patient).includes(specialtyId);
}

/**
 * Model-facing candidates when the user already gave recognizable clinical
 * evidence. Unknown/novel language still goes to the semantic model with
 * the complete active taxonomy, but its eventual choice is checked again.
 */
export function modelCandidateIds(
  routing: ComplaintRouting,
  patient: PatientProfile,
): string[] | null {
  if (!routing.candidates.length) return null;
  return supportedReferralIds(routing, patient);
}
