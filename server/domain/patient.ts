import { normalize } from './text.js';

const relatives =
  /\b(?:minh[ao]|noss[ao]|meu)\s+(filh[ao]|net[ao]|sobrinh[ao]|entead[ao]|afilhad[ao]|irma[oa]?|pai|mae|espos[ao]|marido|mulher)\b/;
const possibleChild = /^(filh[ao]|net[ao]|sobrinh[ao]|entead[ao]|afilhad[ao])$/;
const numberWords: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezasseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
};
const numberPattern = `(?:\\d{1,3}|(?:${Object.keys(numberWords).join('|')})(?: e (?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?)`;
const agePattern = new RegExp(`\\b(${numberPattern})\\s*(anos?|mes(?:es)?|semanas?|dias?)\\b`, 'g');
function numberValue(value: string) {
  return /^\d+$/.test(value)
    ? Number(value)
    : value.split(' e ').reduce((sum, part) => sum + numberWords[part], 0);
}

export interface PatientProfile {
  relationship: string | null;
  ageYears: number | null;
  adultReported: boolean;
  needsAge: boolean;
}
export const patientRelationship = (message: string) => normalize(message).match(relatives)?.[1];

/** Read age of the patient, not the caregiver. No name or birth date is needed or retained. */
export function patientProfile(messages: string[], answeringAge = false): PatientProfile {
  let relationship: string | null = null;
  let ageYears: number | null = null;
  let adultReported = false;
  let childMention = false;
  for (const [index, message] of messages.entries()) {
    const text = normalize(message);
    const relation = text.match(relatives);
    if (relation) {
      if (relationship && relationship !== relation[1]) {
        ageYears = null;
        adultReported = false;
        childMention = false;
      }
      relationship = relation[1];
    }
    // Ignore age mentioned before the patient and first-person caregiver clauses after it.
    const patientText = relation ? text.slice(relation.index! + relation[0].length) : text;
    const segments = patientText.split(/[.!?;]|\b(?:e eu|mas eu)\b/);
    for (const segment of segments) {
      const ownAge = /^\s*(?:eu\s+)?(?:tenho|estou com|sou)\b|\bminha idade\b/.test(segment);
      if (relationship && ownAge) continue;
      childMention ||= /\b(bebe|crianca|menina|menino|adolescente)\b/.test(segment);
      if (
        /\b(adult[ao]|idos[ao])\b/.test(segment) &&
        !/\bnao (?:e|sou|eh)\s+(?:uma?\s+)?(?:adult[ao]|idos[ao])\b/.test(segment)
      )
        adultReported = true;
      for (const match of segment.matchAll(agePattern)) {
        const before = segment.slice(Math.max(0, match.index! - 45), match.index);
        // "Coceira há 5 anos" is symptom duration, not age.
        if (
          /\b(?:ha|desde(?: os| as)?|durante|faz|por|comecou a|quando tinha)\s*(?:mais de |cerca de )?$/.test(
            before,
          )
        )
          continue;
        const unit = match[2];
        const explicitAge = /(?:\b(?:tem|tenho|idade|de|com)|nascid[ao] ha)\s*$/.test(before);
        const shortAnswer = answeringAge && index === messages.length - 1;
        if (!unit.startsWith('ano') && !explicitAge && !shortAnswer && !relation) continue;
        if (
          !unit.startsWith('ano') &&
          /\b(coceira|dor|comec|sintoma|sentindo)\w*\b/.test(before) &&
          !/\btem\s*$/.test(before)
        )
          continue;
        const amount = numberValue(match[1]);
        const years = unit.startsWith('ano')
          ? amount
          : unit.startsWith('mes')
            ? amount / 12
            : unit.startsWith('semana')
              ? amount / 52
              : amount / 365;
        if (Number.isFinite(years) && years >= 0 && years <= 120) {
          ageYears = years;
          adultReported = years >= 20;
        }
      }
    }
    if (answeringAge && index === messages.length - 1) {
      const bare = text.trim().match(new RegExp(`^(${numberPattern})[.!]?$`));
      if (bare && numberValue(bare[1]) <= 120) {
        ageYears = numberValue(bare[1]);
        adultReported = ageYears >= 20;
      }
    }
  }
  return {
    relationship,
    ageYears,
    adultReported,
    needsAge:
      ageYears === null &&
      !adultReported &&
      (childMention || possibleChild.test(relationship ?? '')),
  };
}
