import type { ChatContext, ClarificationTopic } from '../../shared/contracts.js';
import { normalize } from './text.js';
import { hasMusculoskeletalLocation } from './clinical-vocabulary.js';
import { assessDetail, clarificationQuestions } from './clarification.js';

/**
 * A body location alone is not enough to decide the first point of care.
 * This is an intake gate, not a diagnosis: it asks for discriminating facts
 * before allowing the clinical router/model to recommend a specialty.
 *
 * Questions come from a finite set controlled by the backend. No model can
 * generate medication advice, an arbitrary question or a clinic here.
 */
const jointOrBack =
  /\b(?:costas|coluna|lombar|ombro|ombros|joelho|joelhos|tornozelo|tornozelos|pe|pes|quadril|cotovelo|punho|punhos|braco|bracos|perna|pernas|articulacao|articulacoes|pescoco|cervical)\b/;
const pain = /\b(?:dor|dores|doendo|doi|dolorid\w*|inc[oô]modo|incomodo|desconforto)\b/;
const explicitlyDefinedCare =
  /\b(?:diagnosticad[ao]|diagnostico confirmado|ja tenho diagnostico|fratura confirmada|entorse confirmada|encaminhamento medico)\b/;

export function needsMusculoskeletalIntake(messages: string[]): boolean {
  const text = normalize(messages.join(' '));
  return (jointOrBack.test(text) || hasMusculoskeletalLocation(text)) &&
    pain.test(text) && !explicitlyDefinedCare.test(text);
}

/**
 * Gather the start and the associated warning signs, then context such as a
 * fall/effort or limitation. Do not ask already answered questions.
 * A missing answer may be retried, but the existing 3-round cap applies.
 */
export function musculoskeletalIntakeTopics(
  messages: string[],
  previous?: ChatContext['care'],
): ClarificationTopic[] {
  if (!needsMusculoskeletalIntake(messages)) return [];
  const assessment = assessDetail(messages);
  // A short "não", "nenhum" or "nada" is a meaningful answer to an
  // immediately preceding question about associated symptoms. Only interpret
  // it this way when the question was actually asked in this episode.
  const shortAnswer = normalize(messages.at(-1) ?? '').trim();
  if (
    previous?.questions.includes('associated_symptoms') &&
    /^(?:nao|nenhum|nenhuma|nada|nao tenho|nao sinto|nao percebi|nenhum deles|nenhuma delas)[.! ]*$/.test(shortAnswer)
  ) {
    assessment.known.add('associated_symptoms');
  }
  for (const answered of previous?.answeredTopics ?? []) assessment.known.add(answered);
  const desired: ClarificationTopic[] = [
    'onset_duration',
    'associated_symptoms',
    'trigger',
  ];
  // A meaningful trajectory and associated symptoms are more important than
  // collecting every detail. Once both are known and one of trigger/pattern/
  // impact is known, continue to routing instead of interrogating needlessly.
  const enough =
    assessment.known.has('onset_duration') &&
    assessment.known.has('associated_symptoms') &&
    (assessment.known.has('trigger') ||
      assessment.known.has('pattern') ||
      assessment.known.has('impact'));
  if (enough) return [];
  return clarificationQuestions(assessment, desired, previous);
}
