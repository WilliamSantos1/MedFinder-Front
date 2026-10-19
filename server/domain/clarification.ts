import type { ChatRequest, ClarificationTopic } from '../../shared/contracts.js';
import { normalize } from './text.js';
import { patientProfile, patientRelationship } from './patient.js';

const regions = [
  ['head', /\b(cabeca|cefaleia)\b/],
  ['neck', /\b(pescoco|nuca|cervical)\b/],
  ['eye', /\b(olhos?|visao)\b/],
  ['skin', /\b(pele|mancha|erupcao)\b/],
  ['urinary', /\b(urinar|urina|urinaria|bexiga|genital|penis|vagina)\b/],
  ['back', /\b(costas|coluna|lombar)\b/],
  ['ear', /\b(ouvido|audicao)\b/],
  ['airway', /\b(garganta|nariz|tosse|rouquidao|espirro|respirar)\b/],
  ['abdomen', /\b(barriga|estomago|abdomen|abdominal|intestino)\b/],
  ['limbs', /\b(braco|perna|joelho|ombro|mao|pe|tornozelo|articulacao)s?\b/],
] as const;
const symptom =
  /\b(dor|dores|doi|doendo|doente|ardencia|coceira|cocando|cocar|desconforto|tosse|manchas?)\b/;
const bodyRegion = (text: string) => regions.find(([, pattern]) => pattern.test(text))?.[0];

/** Scope non-urgent context to the current complaint; safety still examines the full history. */
export function careConversation(request: ChatRequest) {
  const current = normalize(request.message);
  const previousPerson = [...request.history].reverse().map(patientRelationship).find(Boolean);
  const currentPerson = patientRelationship(request.message);
  const previousRegion = [...request.history]
    .reverse()
    .map(normalize)
    .map(bodyRegion)
    .find(Boolean);
  // Moving the head while describing neck pain is not a new headache complaint.
  const complaint = current.match(
    /\b(?:dor|dores|doi|doendo|ardencia|coceira|desconforto)\s+(?:(?:forte|intensa|muito|leve|moderada|de|no|na|nos|nas|em|meu|minha)\s+){0,5}[a-z]+/,
  );
  const currentRegion = complaint ? bodyRegion(complaint[0]) : undefined;
  const newPerson =
    Boolean(currentPerson && currentPerson !== previousPerson) ||
    Boolean(previousPerson && /\bagora (?:eu|sou eu)\b/.test(current));
  const newComplaint =
    newPerson ||
    (symptom.test(current) &&
      (!request.context?.care ||
        /\b(outra queixa|outro problema|outra pessoa)\b/.test(current) ||
        (currentRegion && previousRegion && currentRegion !== previousRegion)));
  return {
    history: newComplaint ? [] : request.history,
    care: newComplaint ? undefined : request.context?.care,
  };
}

/** Detect clearly generic complaints. These signals are not a mandatory intake checklist. */
export function assessDetail(messages: string[]) {
  const text = normalize(messages.join('\n'));
  const known = new Set<ClarificationTopic>();
  if (
    bodyRegion(text) ||
    /\b(ansiedade|insonia|tristeza|fadiga|cansaco|coceira|cocando|cocar)\b/.test(text)
  )
    known.add('location');
  if (
    /\b(hoje|ontem|anteontem|de repente|aos poucos|gradualmente|ha (?:um|uma|dois|duas|tres|\d+) anos?)\b/.test(
      text,
    ) ||
    /\b(?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|alguns|algumas|poucos|poucas)\s+(?:minutos?|horas?|dias?|semanas?|meses)\b/.test(
      text,
    )
  )
    known.add('onset_duration');
  if (
    /\b(pressao|pontadas?|pulsando|pulsacao|lateja\w*|queimacao|constante|intermitente|vai e volta|todos os dias|um lado|lado direito|lado esquerdo|descamando|bolhas?|manchas?|catarro|tosse seca)\b/.test(
      text,
    )
  )
    known.add('pattern');
  if (
    /\b(febre|formigamento|dormencia|nausea|enjoo|vomito|sangramento|vermelhidao|secrecao|sem outros sintomas|nenhum outro sintoma|nao tenho outros sintomas|nao sinto mais nada)\b/.test(
      text,
    )
  )
    known.add('associated_symptoms');
  if (
    /\b(piora|melhora|apos|depois (?:de|que)|desde que|quando (?:viro|mexo|uso)|ao movimentar|ao mexer|ao virar|ao caminhar|ao trabalhar|irradia|espalha|acordar)\b/.test(
      text,
    )
  )
    known.add('trigger');
  if (
    /\b(atrapalha|impede|consigo trabalhar|consigo dormir|consigo andar|atividades|rotina)\b/.test(
      text,
    )
  )
    known.add('impact');
  const patient = patientProfile(messages);
  if (patient.ageYears !== null || patient.adultReported) known.add('age_group');
  const descriptive = ['pattern', 'associated_symptoms', 'trigger', 'impact'].some((topic) =>
    known.has(topic as ClarificationTopic),
  );
  // Longer unfamiliar descriptions are left to semantic assessment by the model.
  // Missing a particular keyword (or a duration) must not force an interview.
  const contentWords =
    text
      .replace(
        /\b(?:eu|ele|ela|meu|minha|pai|mae|filha|filho|esta|estou|com|uma?|de|no|na|e|que|muito|muita|forte|intensa|sentindo|tenho|tem|anos|onde|devo|levar|ir|qual|especialista|procurar|por|favor|agora)\b|\d+/g,
        ' ',
      )
      .match(/[a-z]+/g) ?? [];
  const generic = !descriptive && contentWords.length < 12;
  const missing: ClarificationTopic[] = [];
  if (generic) {
    if (!known.has('location')) missing.push('location');
    if (!known.has('onset_duration')) missing.push('onset_duration');
    if (!descriptive)
      missing.push(
        bodyRegion(text) === 'head' || bodyRegion(text) === 'neck'
          ? 'pattern'
          : 'associated_symptoms',
      );
  }
  return { text, known, missing, sufficient: !generic, generic };
}

export function questionText(topic: ClarificationTopic, text: string) {
  const questions: Record<ClarificationTopic, string> = {
    location:
      'Em qual parte do corpo você sente o desconforto? Indique o local mais exato que conseguir.',
    onset_duration: 'Há quanto tempo isso começou? O início foi de repente ou aos poucos?',
    pattern:
      bodyRegion(text) === 'head'
        ? 'Em que região da cabeça a dor aparece e como ela é: pressão, pontadas, pulsação ou de outro jeito?'
        : bodyRegion(text) === 'neck'
          ? 'A dor fica só no pescoço ou se espalha para ombros ou braços? Ela muda ao movimentar o pescoço?'
          : 'Como é o desconforto? Ele é constante ou vai e volta?',
    associated_symptoms:
      'Além desse desconforto, você percebeu algum outro sintoma? Descreva quais, ou diga se não percebeu nenhum.',
    trigger: 'Você percebe algo que inicia, piora ou melhora o desconforto?',
    impact: 'Como o desconforto está afetando suas atividades e seu sono?',
    age_group: /\bfilha\b/.test(text)
      ? 'Qual é a idade da sua filha? Informe em anos ou, se for bebê, em meses.'
      : /\bfilho\b/.test(text)
        ? 'Qual é a idade do seu filho? Informe em anos ou, se for bebê, em meses.'
        : 'Qual é a idade da pessoa com esse desconforto? Informe em anos ou, se for bebê, em meses.',
  };
  return questions[topic];
}

export function clarificationQuestions(
  assessment: ReturnType<typeof assessDetail>,
  requested: ClarificationTopic[],
  previous?: NonNullable<ChatRequest['context']>['care'],
) {
  if ((previous?.round ?? 0) >= 3) return [];
  const asked = new Set(previous?.askedTopics ?? []);
  const candidates: ClarificationTopic[] = [
    ...assessment.missing,
    ...requested,
    ...(assessment.generic
      ? (['associated_symptoms', 'trigger', 'impact'] as ClarificationTopic[])
      : []),
  ];
  return [...new Set(candidates)]
    .filter((topic) => !assessment.known.has(topic) && !asked.has(topic))
    .slice(0, 2);
}
