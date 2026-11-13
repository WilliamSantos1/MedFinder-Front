import { normalize } from './text.js';

/**
 * Suppress explicitly ABSENT symptoms when collecting positive evidence for
 * a first-referral specialty. The raw conversation remains intact for safety,
 * negation analysis and interview memory. Only the lexical specialty scoring
 * sees this filtered text; we never drop severe reports like "não consigo urinar".
 *
 * This is a conservative language heuristic, not a clinical finding.
 */
export function positiveEvidenceText(message: string): string {
  // Preserve utterance boundaries. Normalizing the entire transcript at once
  // turns newlines into spaces, letting 'não tenho outros sintomas' swallow
  // a positive fact from the NEXT answer (e.g. 'levantei uma televisão').
  const text = message.split(/\r?\n/).map(normalize).join('\n');
  return text
    .replace(/\bnao\s+(?:doi|doem|doeu|doia|esta doendo|estao doendo|arde|co[cç]a|inchou|incha)\b/g, ' ')
    .replace(
    /\b(?:sem|nao\s+(?:ha|havia|tem|tenho|sinto|apresento|apresenta|percebo|percebi|notei|observei|sofri|sofreu|houve|teve)|nenhum(?:a|s|as)?)\s+(?:(?!\bmas\b|\be\s+(?:com|tenho|sinto|apresento|estou)\b|[,;.!?\n]).){0,110}/g,
    ' ',
  );
}
