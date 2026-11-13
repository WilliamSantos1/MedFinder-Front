import type { ClarificationTopic } from '../../shared/contracts.js';
import type { PatientProfile } from './patient.js';
import type { ComplaintRouting } from './specialty-routing.js';
import { broadFallbackId } from './specialty-routing.js';
import { isSupportedReferral } from './referral-validation.js';

/**
 * Reconcile a model's choice with independently scored current-patient facts.
 *
 * Scores are NOT calibrated probabilities. We only override a general/model
 * response when an organ-specific area dominates by a substantial margin AND
 * the patient has supplied discriminating details. Do not infer diagnosis.
 * No extra model inference or network request occurs on this path.
 */
export function selectEvidenceBackedReferral(
  routing: ComplaintRouting,
  patient: PatientProfile,
  modelChoice: string | null,
  answered: ReadonlySet<ClarificationTopic>,
): { specialtyId: string; decision: 'model' | 'evidence' | 'broad' } {
  const broad = broadFallbackId(patient);
  const selected = modelChoice && isSupportedReferral(modelChoice, routing, patient)
    ? modelChoice
    : null;
  const [first, runnerUp] = routing.candidates;
  if (!first || first.id === broad) {
    return selected
      ? { specialtyId: selected, decision: 'model' }
      : { specialtyId: broad, decision: 'broad' };
  }

  const gap = first.score - (runnerUp?.score ?? 0);
  const adequateInterview = answered.has('onset_duration') &&
    (answered.has('associated_symptoms') || answered.has('trigger') || answered.has('pattern'));
  const dominant = first.score >= 23 && gap >= 7 && adequateInterview &&
    isSupportedReferral(first.id, routing, patient);

  // A rejected answer, or a broad answer against already-complete and clear
  // specific evidence, should not erase a correctly supported candidate.
  if (dominant && (!selected || selected === broad)) {
    return { specialtyId: first.id, decision: 'evidence' };
  }

  // A model can choose other plausible specialist areas when there are several
  // genuinely defensible paths. But it must not overrule a much stronger,
  // completed presentation with only a weak lexical candidate.
  if (selected && selected !== broad && dominant) {
    const score = routing.candidates.find(({ id }) => id === selected)?.score ?? 0;
    if (first.score - score >= 10) {
      return { specialtyId: first.id, decision: 'evidence' };
    }
  }

  return selected
    ? { specialtyId: selected, decision: 'model' }
    : { specialtyId: broad, decision: 'broad' };
}
