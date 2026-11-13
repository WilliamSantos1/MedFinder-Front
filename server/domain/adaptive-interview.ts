import type { ChatContext, ClarificationTopic } from '../../shared/contracts.js';
import { assessDetail, clarificationQuestions } from './clarification.js';
import { musculoskeletalIntakeTopics, needsMusculoskeletalIntake } from './musculoskeletal-interview.js';
import { normalize } from './text.js';
import { vocabularyDomains } from './clinical-vocabulary.js';
import { assessAnatomicalDifferential } from './anatomical-differential.js';

type Care = ChatContext['care'];

/**
 * Conservative, domain-aware intake. This does not diagnose or exclude a condition.
 * Emergency detection must run before this function. Questions are deterministic,
 * bounded by the existing three-round chat context, and never generated freely.
 */
export function adaptiveIntakeTopics(
  messages: string[],
  previous?: Care,
): ClarificationTopic[] {
  if (needsMusculoskeletalIntake(messages)) {
    return musculoskeletalIntakeTopics(messages, previous);
  }

  const text = normalize(messages.join(' '));
  const assessment = assessDetail(messages);
  const symptomPain = /\b(?:dor|dores|doi|doendo|dolorid\w*)\b/.test(text);

  const headache = symptomPain && /\b(?:cabeca|cefaleia)\b/.test(text) &&
    !/\b(?:enxaqueca diagnosticada|diagnostico de enxaqueca)\b/.test(text);
  const abdomen = symptomPain && /\b(?:barriga|estomago|abdomen|abdominal|ventre)\b/.test(text);
  const dizziness = /\b(?:tontura|vertigem|desequilibrio|sensacao de desmaio)\b/.test(text);
  const pelvic = /\b(?:virilha|pelve|pelvica|pelvico|baixo ventre|perineo|pe da barriga|bacia|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica)\b/.test(text) &&
    /\b(?:dor|dores|desconforto|espasmos?|caibras?|pressao|pontadas?)\b/.test(text);
  const crossSystemSite = assessAnatomicalDifferential(messages.join('\n')).unresolved;
  const digestive = vocabularyDomains(text).includes('digestive') &&
    /\b(?:diarreia|disenteria|desinteria|dissenteria|disinteria|fezes liquidas|intestino solto|vomitos frequentes)\b/.test(text);
  const unexplainedFever = /\bfebre\b/.test(text) &&
    !/\b(?:dor|dores|tosse|coriza|garganta|diarreia|vomito|urina)\b/.test(text);

  let desired: ClarificationTopic[];
  if (digestive) {
    // Ask onset and associated warning signs before considering routine referral.
    desired = ['onset_duration', 'associated_symptoms'];
  } else if (crossSystemSite) {
    desired = ['onset_duration', 'associated_symptoms', 'trigger'];
  } else if (headache || abdomen || dizziness || pelvic) {
    desired = ['onset_duration', 'associated_symptoms', 'pattern'];
  } else if (unexplainedFever) {
    desired = ['onset_duration', 'associated_symptoms'];
  } else {
    return [];
  }

  const known = new Set(assessment.known);
  const shortAnswer = normalize(messages.at(-1) ?? '');
  if (
    previous?.questions.includes('associated_symptoms') &&
    /^(?:nao|nenhum|nenhuma|nada|nao tenho|nao sinto|nenhum outro sintoma)[.! ]*$/.test(shortAnswer)
  ) known.add('associated_symptoms');

  // Do not repeat answered topics; ask one extra discriminating question only
  // when it would materially change the initial care destination.
  for (const answered of previous?.answeredTopics ?? []) known.add(answered);
  if (known.has('onset_duration') && known.has('associated_symptoms') &&
      (!crossSystemSite || known.has('trigger'))) return [];

  return clarificationQuestions({ ...assessment, known }, desired, previous);
}
