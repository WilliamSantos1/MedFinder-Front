import { normalize } from './text.js';
import { hasVocabularyHealthTerm } from './clinical-vocabulary.js';

export type PatientSubject =
  | 'self'
  | 'son'
  | 'daughter'
  | 'father'
  | 'mother'
  | 'grandfather'
  | 'grandmother'
  | 'grandson'
  | 'granddaughter'
  | 'brother'
  | 'sister'
  | 'husband'
  | 'wife'
  | 'partner'
  | 'uncle'
  | 'aunt'
  | 'nephew'
  | 'niece'
  | 'cousin'
  | 'friend'
  | 'teacher'
  | 'colleague'
  | 'neighbor'
  | 'boss'
  | 'child'
  | 'other';

interface RelativeMatch {
  subject: PatientSubject;
  relationship: string;
  index: number;
  end: number;
}

const relativeMatchers: Array<{
  subject: PatientSubject;
  relationship: string;
  pattern: RegExp;
}> = [
  {
    subject: 'son',
    relationship: 'filho',
    pattern: /\b(?:meu|nosso)(?:\s+outro)?\s+filho\b/,
  },
  {
    subject: 'daughter',
    relationship: 'filha',
    pattern: /\b(?:minha|nossa)(?:\s+outra)?\s+filha\b/,
  },
  {
    subject: 'father',
    relationship: 'pai',
    pattern: /\b(?:meu|nosso)\s+pai\b/,
  },
  {
    subject: 'mother',
    relationship: 'mae',
    pattern: /\b(?:minha|nossa)\s+mae\b/,
  },
  {
    subject: 'grandfather',
    relationship: 'avo',
    pattern: /\b(?:meu|nosso)\s+avo\b/,
  },
  {
    subject: 'grandmother',
    relationship: 'avo',
    pattern: /\b(?:minha|nossa)\s+avo\b/,
  },
  {
    subject: 'grandson',
    relationship: 'neto',
    pattern: /\b(?:meu|nosso)\s+neto\b/,
  },
  {
    subject: 'granddaughter',
    relationship: 'neta',
    pattern: /\b(?:minha|nossa)\s+neta\b/,
  },
  {
    subject: 'brother',
    relationship: 'irmao',
    pattern: /\b(?:meu|nosso)\s+irmao\b/,
  },
  {
    subject: 'sister',
    relationship: 'irma',
    pattern: /\b(?:minha|nossa)\s+irma\b/,
  },
  {
    subject: 'uncle',
    relationship: 'tio',
    pattern: /\b(?:meu|nosso)\s+tio\b/,
  },
  {
    subject: 'aunt',
    relationship: 'tia',
    pattern: /\b(?:minha|nossa)\s+tia\b/,
  },
  {
    subject: 'nephew',
    relationship: 'sobrinho',
    pattern: /\b(?:meu|nosso)\s+sobrinho\b/,
  },
  {
    subject: 'niece',
    relationship: 'sobrinha',
    pattern: /\b(?:minha|nossa)\s+sobrinha\b/,
  },
  {
    subject: 'cousin',
    relationship: 'primo',
    pattern: /\b(?:meu|nosso)\s+primo\b/,
  },
  {
    subject: 'cousin',
    relationship: 'prima',
    pattern: /\b(?:minha|nossa)\s+prima\b/,
  },
  {
    subject: 'husband',
    relationship: 'marido',
    pattern: /\b(?:meu|nosso)\s+(?:marido|esposo)\b/,
  },
  {
    subject: 'wife',
    relationship: 'esposa',
    pattern: /\b(?:minha|nossa)\s+(?:mulher|esposa)\b/,
  },
  {
    subject: 'partner',
    relationship: 'companheiro',
    pattern: /\b(?:meu|nosso)\s+(?:companheiro|namorado)\b/,
  },
  {
    subject: 'partner',
    relationship: 'companheira',
    pattern: /\b(?:minha|nossa)\s+(?:companheira|namorada)\b/,
  },
  {
    subject: 'friend',
    relationship: 'amigo',
    pattern: /\b(?:meu|nosso)\s+amigo\b/,
  },
  {
    subject: 'friend',
    relationship: 'amiga',
    pattern: /\b(?:minha|nossa)\s+amiga\b/,
  },
  {
    subject: 'teacher',
    relationship: 'professor',
    pattern: /\b(?:meu|nosso|o)\s+professor\b/,
  },
  {
    subject: 'teacher',
    relationship: 'professora',
    pattern: /\b(?:minha|nossa|a)\s+professora\b/,
  },
  {
    subject: 'colleague',
    relationship: 'colega',
    pattern: /\b(?:meu|minha|nosso|nossa|o|a)\s+colega\b/,
  },
  {
    subject: 'neighbor',
    relationship: 'vizinho',
    pattern: /\b(?:meu|nosso|o)\s+vizinho\b/,
  },
  {
    subject: 'neighbor',
    relationship: 'vizinha',
    pattern: /\b(?:minha|nossa|a)\s+vizinha\b/,
  },
  {
    subject: 'boss',
    relationship: 'chefe',
    pattern: /\b(?:meu|minha|nosso|nossa|o|a)\s+chefe\b/,
  },
  {
    subject: 'child',
    relationship: 'enteado',
    pattern: /\b(?:meu|nosso)\s+enteado\b/,
  },
  {
    subject: 'child',
    relationship: 'enteada',
    pattern: /\b(?:minha|nossa)\s+enteada\b/,
  },
  {
    subject: 'child',
    relationship: 'afilhado',
    pattern: /\b(?:meu|nosso)\s+afilhado\b/,
  },
  {
    subject: 'child',
    relationship: 'afilhada',
    pattern: /\b(?:minha|nossa)\s+afilhada\b/,
  },
  {
    subject: 'child',
    relationship: 'bebe',
    pattern: /\b(?:meu|minha|nosso|nossa)\s+bebe\b/,
  },
];

const possibleChild = new Set([
  'filho',
  'filha',
  'neto',
  'neta',
  'sobrinho',
  'sobrinha',
  'enteado',
  'enteada',
  'afilhado',
  'afilhada',
  'bebe',
]);

const healthSignal =
  /\b(dor|dores|doendo|coceira|cocando|ardencia|febre|tontura|vertigem|coriza|tosse|enjoo|nausea|vomito|diarreia|sangramento|vermelh\w*|inchaco|caroco|nodulo|formigamento|dormencia|falta de ar|respirar|desconforto|mal estar|cansaco|fadiga|fraqueza|olho|olhos|ouvido|ouvidos|nariz|garganta|pele|cabeca|pescoco|peito|barriga|abdomen|estomago|joelho|ombro|costas|coluna|urinar|urina|bexiga|mama|vagina|penis|testiculo|tireoide|refluxo|enxaqueca|alergia|asma|ansiedade|depressao)\b/;

const directSelf =
  /\b(?:eu\s+)?(?:estou|tenho|sinto|sou)\b|\bcomigo\b|\b(?:meu|minha)\s+(?:olho|ouvido|nariz|garganta|pele|cabeca|pescoco|peito|barriga|estomago|joelho|ombro|braco|mao|perna|pe|costas|coluna|urina|bexiga|mama|tireoide)\b/;

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

const numberPattern =
  `(?:\\d{1,3}|(?:${Object.keys(numberWords).join('|')})(?: e (?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove))?)`;

const agePattern = new RegExp(
  `\\b(${numberPattern})\\s*(anos?|mes(?:es)?|semanas?|dias?)\\b`,
  'g',
);

function numberValue(value: string) {
  return /^\d+$/.test(value)
    ? Number(value)
    : value
        .split(' e ')
        .reduce(
          (sum, part) => sum + numberWords[part],
          0,
        );
}

function relativeMatch(
  message: string,
): RelativeMatch | null {
  const text = normalize(message);

  const matches = relativeMatchers
    .map((candidate) => {
      const match =
        candidate.pattern.exec(text);

      candidate.pattern.lastIndex = 0;

      return match
        ? {
            subject: candidate.subject,
            relationship: candidate.relationship,
            index: match.index,
            end:
              match.index +
              match[0].length,
          }
        : null;
    })
    .filter(
      (
        match,
      ): match is RelativeMatch =>
        Boolean(match),
    )
    .sort(
      (a, b) =>
        a.index - b.index,
    );

  return matches.at(-1) ?? null;
}

export interface PatientProfile {
  relationship: string | null;
  ageYears: number | null;
  adultReported: boolean;
  needsAge: boolean;
}

export const patientRelationship = (
  message: string,
) =>
  relativeMatch(message)
    ?.relationship ?? null;

/**
 * Coarse conversation subject used only to separate clinical episodes.
 * No name, birth date, identifier or free-text profile is retained.
 */
export function explicitPatientSubject(
  message: string,
): PatientSubject | null {
  const text = normalize(message);

  const relation =
    relativeMatch(message);

  if (relation)
    return relation.subject;

  // Pronouns without an explicit relation are continuation markers,
  // not a new patient.
  if (
    /\b(?:ele|ela|eles|elas)\b/.test(text) &&
    !directSelf.test(text)
  )
    return null;

  if (directSelf.test(text))
    return 'self';

  if (
    /\b(?:uma pessoa|outra pessoa|alguem)\b/.test(
      text,
    )
  )
    return 'other';

  return null;
}

export function patientSubject(
  message: string,
): PatientSubject | null {
  const explicit =
    explicitPatientSubject(message);

  if (explicit)
    return explicit;

  const text = normalize(message);

  // Only when looking backwards for an episode anchor do unqualified
  // health complaints default to the speaker.
  // Current short follow-ups without an explicit subject keep the
  // previous patient instead of accidentally switching to "self".
  if (
    (healthSignal.test(text) || hasVocabularyHealthTerm(text)) &&
    !/\b(?:ele|ela|eles|elas)\b/.test(text)
  )
    return 'self';

  return null;
}

export function explicitDifferentPerson(
  message: string,
) {
  const text = normalize(message);

  return (
    /\b(?:outra pessoa|outro paciente|outra paciente)\b/.test(
      text,
    ) ||
    /\b(?:meu|minha|nosso|nossa)\s+(?:outro|outra)\s+(?:filho|filha|neto|neta|sobrinho|sobrinha|irmao|irma|primo|prima|amigo|amiga)\b/.test(
      text,
    ) ||
    /\b(?:agora|desta vez|e agora)\s+(?:sou eu|eu estou|comigo)\b/.test(
      text,
    )
  );
}

/**
 * Read age of the patient, not the caregiver.
 * No name or birth date is needed or retained.
 */
export function patientProfile(
  messages: string[],
  answeringAge = false,
): PatientProfile {
  let relationship: string | null = null;

  let ageYears: number | null = null;

  let adultReported = false;

  let childMention = false;

  for (const [
    index,
    message,
  ] of messages.entries()) {
    const text =
      normalize(message);

    const relation =
      relativeMatch(message);

    if (relation) {
      if (
        relationship &&
        relationship !==
          relation.relationship
      ) {
        ageYears = null;
        adultReported = false;
        childMention = false;
      }

      relationship =
        relation.relationship;
    }

    // Ignore age mentioned before the patient and first-person
    // caregiver clauses after it.
    const patientText =
      relation
        ? text.slice(relation.end)
        : text;

    const segments =
      patientText.split(
        /[.!?;]|\b(?:e eu|mas eu)\b/,
      );

    for (const segment of segments) {
      const ownAge =
        /^\s*(?:eu\s+)?(?:tenho|estou com|sou)\b|\bminha idade\b/.test(
          segment,
        );

      if (
        relationship &&
        ownAge
      )
        continue;

      childMention ||=
        /\b(bebe|crianca|menina|menino|adolescente)\b/.test(
          segment,
        );

      if (
        /\b(adult[ao]|idos[ao])\b/.test(
          segment,
        ) &&
        !/\bnao (?:e|sou|eh)\s+(?:uma?\s+)?(?:adult[ao]|idos[ao])\b/.test(
          segment,
        )
      )
        adultReported = true;

      for (const match of segment.matchAll(
        agePattern,
      )) {
        const before =
          segment.slice(
            Math.max(
              0,
              match.index! - 45,
            ),
            match.index,
          );

        // "Coceira há 5 anos" is symptom duration, not age.
        if (
          /\b(?:ha|desde(?: os| as)?|durante|faz|por|comecou a|quando tinha|duracao de|nos ultimos?|ultimos?|com duracao de)\s*(?:mais de |cerca de )?$/.test(before) ||
          /\b(?:de dor|de sintomas?|de molestias?|de desconforto)\b/.test(segment.slice(match.index! + match[0].length, match.index! + match[0].length + 28)) ||
          /\btenho\s*$/.test(before) && /\bde (?:dor|sintomas?|desconforto)\b/.test(segment.slice(match.index! + match[0].length))
        )
          continue;

        const unit =
          match[2];

        const explicitAge =
          /(?:\b(?:tem|tenho|idade|de|com)|nascid[ao] ha)\s*$/.test(
            before,
          );

        const shortAnswer =
          answeringAge &&
          index === messages.length - 1;

        if (
          !unit.startsWith('ano') &&
          !explicitAge &&
          !shortAnswer &&
          !relation
        )
          continue;

        if (
          !unit.startsWith('ano') &&
          /\b(coceira|dor|comec|sintoma|sentindo)\w*\b/.test(
            before,
          ) &&
          !/\btem\s*$/.test(
            before,
          )
        )
          continue;

        const amount =
          numberValue(match[1]);

        const years =
          unit.startsWith('ano')
            ? amount
            : unit.startsWith('mes')
              ? amount / 12
              : unit.startsWith('semana')
                ? amount / 52
                : amount / 365;

        if (
          Number.isFinite(years) &&
          years >= 0 &&
          years <= 120
        ) {
          ageYears = years;

          adultReported =
            years >= 18;
        }
      }
    }

    if (
      answeringAge && index > 0
    ) {
      const bare =
        text
          .trim()
          .match(
            new RegExp(
              `^(${numberPattern})[.!]?$`,
            ),
          );

      if (
        bare &&
        numberValue(bare[1]) <=
          120
      ) {
        ageYears =
          numberValue(bare[1]);

        adultReported =
          ageYears >= 18;
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
      (childMention ||
        possibleChild.has(
          relationship ?? '',
        )),
  };
}