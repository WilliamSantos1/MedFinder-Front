import { normalize } from './text.js';

const emergencyPatterns = [
  /\b(?:dor|aperto|pressao|peso) (?:forte |intens[ao] )?(?:no|em meu|em) peito\b/g,
  /\b(?:falta de ar|dificuldade (?:para|de|em) respirar|nao consigo respirar|sufocando|sem conseguir respirar)\b/g,
  /\b(?:rosto|boca) (?:esta |ficou )?(?:tort[ao]|caid[ao])\b/g,
  /\b(?:fala enrolada|nao consigo falar|fraqueza (?:em|de) um lado|paralisia|convulsao|convulsionando)\b/g,
  /\b(?:desmai(?:ei|ou|ando)|inconsciente|perda de consciencia)\b/g,
  /\b(?:sangramento (?:intenso|incontrolavel)|vomit(?:ei|ando) sangue|overdose|envenenamento)\b/g,
  /\b(?:quero (?:me matar|morrer)|vou me matar|suicidio|me machucar agora)\b/g,
  /\b(?:lingua|garganta|labios) (?:esta |estao |ficou |ficaram )?(?:inchad[ao]s?|inchando)\b/g,
  /\b(?:pior dor de cabeca|dor de cabeca (?:subita|explosiva))\b/g,
  /\b(?:perda (?:subita )?de visao|nao consigo enxergar)\b/g,
  /\b(?:perfurei|machuquei|feri) (?:o|meu) olho\b/g,
  /\bdor (?:abdominal|na barriga|no estomago) (?:muito )?(?:forte|intensa|subita)\b/g,
  /\bdor (?:muito )?(?:forte|intensa|subita) (?:na barriga|no estomago|abdominal)\b/g,
];

function affirmed(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].some((match) => {
    const before = text.slice(Math.max(0, match.index - 50), match.index);
    // Negate only explicit, immediately adjacent denial. Ambiguity stays cautious.
    return !/(?:\bnao (?:tenho|sinto|apresento|estou com)|\bsem|\bnego|\bnem|\bausencia de)\s+(?:mais\s+)?$/.test(
      before,
    );
  });
}

export function detectUrgency(messages: string[]): 'emergency' | 'prompt' | null {
  const normalizedMessages = messages.map(normalize);
  if (
    normalizedMessages.some((text) => affirmed(text, /\b(?:dor nas costas|dor lombar)\b/g)) &&
    normalizedMessages.some((text) =>
      affirmed(
        text,
        /\b(?:fraqueza nas duas pernas|dormencia nas duas pernas|perda de sensibilidade (?:genital|nos genitais)|nao consigo controlar (?:a urina|as fezes))\b/g,
      ),
    )
  )
    return 'emergency';
  if (
    normalizedMessages.some((text) => affirmed(text, /\bfebre\b/g)) &&
    normalizedMessages.some((text) =>
      affirmed(text, /\b(?:rigidez (?:na nuca|no pescoco)|nuca rigida)\b/g),
    )
  )
    return 'emergency';
  for (const message of messages) {
    const text = normalize(message);
    if (emergencyPatterns.some((pattern) => affirmed(text, pattern))) return 'emergency';
    if (
      affirmed(text, /\bfebre\b/g) &&
      affirmed(text, /\b(?:rigidez (?:na nuca|no pescoco)|nuca rigida)\b/g)
    )
      return 'emergency';
  }
  for (const message of messages) {
    const text = normalize(message);
    if (
      affirmed(
        text,
        /\b(?:dor (?:muito forte|insuportavel)|visao (?:perdida|emba[cç]ada) de repente|dor (?:forte|intensa) (?:no olho|nos olhos))\b/g,
      )
    )
      return 'prompt';
    if (
      affirmed(text, /\b(?:queda|acidente|trauma|batida)\b/g) &&
      /\b(?:pescoco|cabeca|coluna)\b/.test(text)
    )
      return 'prompt';
  }
  return null;
}

export function isUnsafeOutput(answer: string) {
  const value = normalize(answer);
  return (
    /\b(?:tome|tomar|use|usar|recomendo|prescrevo)\b.{0,45}\b(?:mg|ml|comprimido|paracetamol|ibuprofeno|dipirona|antibiotico)/.test(
      value,
    ) ||
    /\b(?:voce tem|seu diagnostico e|com certeza e|nao e (?:grave|urgente)|pode ficar tranquilo|dispensa (?:avaliacao|consulta))\b/.test(
      value,
    ) ||
    /\b(?:nao (?:ha|existe|vejo) (?:indicacao de |sinais? de |uma? )?(?:emergencia|urgencia|risco)|sem (?:nenhum )?risco|urgencia (?:foi )?descartada)\b/.test(
      value,
    ) ||
    /(?:https?:\/\/|www\.|\b(?:r\$|crm\s*\d))/.test(value)
  );
}
