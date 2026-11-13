/**
 * Chat-originated insurance filters belong to a clinical conversation.
 * Manually selected filters remain global until the user changes them.
 * This small client helper only detects clearly stated patient changes;
 * the backend still owns actual clinical episode segmentation.
 */
function simple(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function subject(message: string): string | null {
  const text = simple(message);
  const match = text.match(/\b(?:meu|minha|nosso|nossa)\s+(filh[oa]|pai|mae|avo|espos[ao]|marido|irma[oa]|companheir[oa]|net[oa]|amig[oa]|professor(?:a)?|colega|vizinh[oa]|chefe)\b/);
  if (match) return match[1];
  if (/\b(?:eu\s+)?(?:estou|tenho|sinto)\b/.test(text)) return 'self';
  return null;
}

export function clearlyChangedPatient(message: string, earlier: string[]): boolean {
  const next = subject(message);
  if (!next) return false;
  const last = [...earlier].reverse().map(subject).find((item) => item !== null);
  // A prior catalog-only conversation has no patient subject. A subsequent
  // explicit patient statement starts a fresh clinical context as well.
  return Boolean(next && (last ? last !== next : earlier.length > 0));
}
