import type { ChatRequest, ClarificationTopic } from '../../shared/contracts.js';
import { normalize } from './text.js';
import {
  explicitDifferentPerson,
  explicitPatientSubject,
  patientProfile,
  patientSubject,
  type PatientSubject,
} from './patient.js';

const regions = [
  ['head', /\b(cabeca|cefaleia)\b/],
  ['neck', /\b(pescoco|nuca|cervical)\b/],
  ['eye', /\b(olhos?|visao|ocular)\b/],
  ['skin', /\b(pele|manchas?|erupcao|urticaria)\b/],
  ['urinary', /\b(urinar|urina|urinaria|bexiga|genital|penis|vagina)\b/],
  ['back', /\b(costas|coluna|lombar)\b/],
  ['ear', /\b(ouvido|audicao)\b/],
  ['airway', /\b(garganta|nariz|coriza|rinite|congestao|tosse|rouquidao|espirros?|respirar)\b/],
  ['abdomen', /\b(barriga|estomago|abdomen|abdominal|intestino)\b/],
  ['limbs', /\b(braco|perna|joelho|ombro|mao|pe|tornozelo|articulacao)s?\b/],
] as const;

const symptom =
  /\b(dor|dores|doi|doendo|doente|ardencia|coceira|cocando|cocar|desconforto|tosse|coriza|rinite|congestao|espirros?|vermelh\w*|manchas?|tontura|vertigem|febre|enjoo|nausea|vomito|diarreia|sangramento|formigamento|dormencia|fraqueza|cansaco|fadiga|inchaco|caroco|nodulo|refluxo|azia|palpitacao|insonia|ansiedade)\b/;

const clinicalDomains = [
  ['eye', /\b(olhos?|ocular|visao|vista|palpebra|cornea|retina|glaucoma|catarata)\b/],
  ['ent', /\b(ouvidos?|audicao|zumbido|nariz|sinusite|rinite|coriza|garganta|rouquidao)\b/],
  ['skin', /\b(pele|manchas?|erupcao|urticaria|coceira|prurido|acne|micose)\b/],
  [
    'musculoskeletal',
    /\b(joelho|ombro|tornozelo|quadril|cotovelo|punho|mao|dedos?|pe|pes|osso|ossos|articulacao|articulacoes|coluna|lombar|pescoco|cervical|musculo|tendao|ligamento|entorse|fratura|luxacao)\b/,
  ],
  [
    'neurologic',
    /\b(enxaqueca|cefaleia|dor de cabeca|tontura|vertigem|tremor|formigamento|dormencia|convuls\w*|memoria|equilibrio)\b/,
  ],
  [
    'cardiovascular',
    /\b(coracao|palpitacao|palpitacoes|arritmia|pressao alta|hipertensao|taquicardia|bradicardia)\b/,
  ],
  [
    'respiratory',
    /\b(pulmao|pulmoes|asma|bronquite|enfisema|dpoc|chiado|tosse|catarro|falta de ar|respirar)\b/,
  ],
  [
    'digestive',
    /\b(refluxo|azia|gastrite|estomago|abdomen|abdominal|barriga|intestino|digestao|figado|vesicula|pancreas|nausea|enjoo|vomito|diarreia|constipacao|prisao de ventre|estufamento)\b/,
  ],
  [
    'urinary',
    /\b(urinar|urina|urinaria|bexiga|prostata|testiculo|testiculos|penis|rim|rins|renal|ardencia ao urinar|incontinencia urinaria)\b/,
  ],
  [
    'gynecologic',
    /\b(vagina|vaginal|vulva|utero|ovario|ovarios|menstruacao|menstrual|menopausa|gravidez|gestante|mama|mamas|seio|seios)\b/,
  ],
  [
    'endocrine',
    /\b(tireoide|diabetes|glicose|glicemia|insulina|hormonio|hormonal|metabolismo|obesidade)\b/,
  ],
  ['mental', /\b(ansiedade|depressao|panico|insonia|sono|tristeza|humor|estresse)\b/],
  ['general', /\b(febre|cansaco|fadiga|fraqueza|mal estar)\b/],
] as const;

type ClinicalDomain = (typeof clinicalDomains)[number][0];

type ClinicalEpisode = {
  messages: string[];
  domains: Set<ClinicalDomain>;
  subject: PatientSubject | null;
};

const bodyRegion = (text: string) => regions.find(([, pattern]) => pattern.test(text))?.[0];

function complaintDomains(text: string) {
  return new Set<ClinicalDomain>(
    clinicalDomains.filter(([, pattern]) => pattern.test(text)).map(([domain]) => domain),
  );
}

function specificDomains(text: string) {
  return new Set<ClinicalDomain>(
    [...complaintDomains(text)].filter((domain) => domain !== 'general'),
  );
}

function setsOverlap<T>(a: Set<T>, b: Set<T>) {
  return [...a].some((value) => b.has(value));
}

const continuationCue =
  /\b(tambem|alem disso|junto com|junto|continua|continuo|continuando|ainda|piorou|melhorou|desde entao|ele|ela|eles|elas|isso|essa dor|esse sintoma|o mesmo|a mesma)\b/;

const revisitCue =
  /\b(aquela|aquele|aquilo|voltando|voltar|retomando|de antes|anterior|que comentei|que falei|que mencionei|sobre o que falei|sobre aquilo)\b/;

const freshComplaintCue =
  /^(?:bom dia[, ]*|boa tarde[, ]*|boa noite[, ]*)?(?:(?:eu\s+)?(?:estou|tenho|sinto|comecei|apareceu)|(?:meu|minha|nosso|nossa)\b|(?:dor|coceira|ardencia|refluxo|azia|tontura|vertigem|tosse|febre|nausea|enjoo|diarreia|ansiedade|insonia)\b)/;

const explicitNewComplaintCue =
  /\b(?:outra queixa|outro problema|novo problema|nova queixa|outra coisa|agora sobre outra coisa)\b/;

function caregiverSelfAgeReply(text: string) {
  return /^(?:eu\s+)?(?:tenho|estou com)\s+(?:\d{1,3}|[a-z]+(?:\s+e\s+[a-z]+)?)\s+anos?[.! ]*$/.test(
    text.trim(),
  );
}

function mergeDomains(target: Set<ClinicalDomain>, source: Set<ClinicalDomain>) {
  for (const domain of source) target.add(domain);
}

/**
 * Split only the user-message history into clinical foci. Nothing is deleted from the real chat:
 * this segmentation merely decides which previous messages are relevant to the current routing.
 */
function segmentEpisodes(
  history: string[],
  waitingForPatientAge = false,
): ClinicalEpisode[] {
  const episodes: ClinicalEpisode[] = [];

  for (const message of history) {
    const text = normalize(message);
    const domains = specificDomains(text);
    const explicitSubject = explicitPatientSubject(message);
    const inferredSubject = explicitSubject ?? patientSubject(message);
    const previous = episodes.at(-1);

    if (!previous) {
      episodes.push({
        messages: [message],
        domains,
        subject: inferredSubject,
      });
      continue;
    }

    const caregiverAgeInsteadOfPatientAge = Boolean(
      waitingForPatientAge &&
        previous.subject &&
        previous.subject !== 'self' &&
        explicitSubject === 'self' &&
        caregiverSelfAgeReply(text) &&
        !explicitDifferentPerson(message),
    );

    const personChanged =
      !caregiverAgeInsteadOfPatientAge &&
      (explicitDifferentPerson(message) ||
        Boolean(explicitSubject && previous.subject && explicitSubject !== previous.subject));

    const freshIndependentComplaint = Boolean(
      !continuationCue.test(text) &&
        freshComplaintCue.test(text) &&
        previous.domains.size &&
        domains.size &&
        !setsOverlap(previous.domains, domains),
    );

    const explicitNewComplaint = explicitNewComplaintCue.test(text);

    if (personChanged || explicitNewComplaint || freshIndependentComplaint) {
      episodes.push({
        messages: [message],
        domains,
        subject: inferredSubject ?? previous.subject,
      });
      continue;
    }

    previous.messages.push(message);
    mergeDomains(previous.domains, domains);
    if (!previous.subject && inferredSubject) previous.subject = inferredSubject;
  }

  return episodes;
}

function mostRecentSubject(history: string[]) {
  return [...history].reverse().map(patientSubject).find(Boolean) ?? null;
}

function findRevisitedEpisode(
  episodes: ClinicalEpisode[],
  currentDomains: Set<ClinicalDomain>,
  currentSubject: PatientSubject | null,
) {
  if (!currentDomains.size) return null;

  return (
    [...episodes]
      .reverse()
      .find(
        (episode) =>
          setsOverlap(episode.domains, currentDomains) &&
          (!currentSubject || !episode.subject || episode.subject === currentSubject),
      ) ?? null
  );
}

/**
 * Select the clinical focus for this turn without erasing the real conversation history.
 *
 * - Related follow-ups keep the latest episode.
 * - A different person opens a new focus.
 * - A fresh, unrelated symptom from the same person opens a new focus, so the previous specialty
 *   cannot dominate the new complaint.
 * - A retrospective phrase such as "aquela dor no joelho" can recover an older matching focus.
 */
export function careConversation(request: ChatRequest) {
  const current = normalize(request.message);
  const waitingForPatientAge = request.context?.care?.questions.includes('age_group') ?? false;
  const episodes = segmentEpisodes(request.history, waitingForPatientAge);
  const latest = episodes.at(-1);

  const previousSubject = latest?.subject ?? mostRecentSubject(request.history);
  const currentSubject = explicitPatientSubject(request.message);
  const currentDomains = specificDomains(current);

  const caregiverAgeInsteadOfPatientAge = Boolean(
    waitingForPatientAge &&
      previousSubject &&
      previousSubject !== 'self' &&
      currentSubject === 'self' &&
      caregiverSelfAgeReply(current) &&
      !explicitDifferentPerson(request.message),
  );

  const newPerson = Boolean(
    !caregiverAgeInsteadOfPatientAge &&
      (explicitDifferentPerson(request.message) ||
        (currentSubject && previousSubject && currentSubject !== previousSubject)),
  );

  const explicitNewComplaint = explicitNewComplaintCue.test(current);
  const looksLikeFreshComplaint = freshComplaintCue.test(current) && !continuationCue.test(current);
  const latestDomains = latest?.domains ?? new Set<ClinicalDomain>();

  const domainChanged = Boolean(
    !newPerson &&
      looksLikeFreshComplaint &&
      latestDomains.size &&
      currentDomains.size &&
      !setsOverlap(latestDomains, currentDomains),
  );

  const previousRegion = latest?.messages
    .map(normalize)
    .map(bodyRegion)
    .reverse()
    .find(Boolean);
  const currentRegion = bodyRegion(current);
  const regionChanged = Boolean(
    !newPerson &&
      looksLikeFreshComplaint &&
      symptom.test(current) &&
      currentRegion &&
      previousRegion &&
      currentRegion !== previousRegion,
  );

  const revisit =
    !newPerson && revisitCue.test(current)
      ? findRevisitedEpisode(episodes, currentDomains, currentSubject ?? previousSubject)
      : null;

  if (revisit && revisit !== latest) {
    return {
      history: revisit.messages,
      care: undefined,
      newEpisode: true,
      newPerson: false,
      currentSubject,
      previousSubject,
    };
  }

  const newEpisode = newPerson || explicitNewComplaint || domainChanged || regionChanged;

  return {
    history: newEpisode ? [] : (latest?.messages ?? []),
    care: newEpisode ? undefined : request.context?.care,
    newEpisode,
    newPerson,
    currentSubject,
    previousSubject,
  };
}

/** Detect clearly generic complaints. These signals are not a mandatory intake checklist. */
export function assessDetail(messages: string[]) {
  const text = normalize(messages.join('\n'));
  const known = new Set<ClarificationTopic>();

  if (
    bodyRegion(text) ||
    /\b(ansiedade|insonia|tristeza|fadiga|cansaco|coceira|cocando|cocar|coriza|rinite|congestao|tontura|vertigem|febre|nausea|enjoo|vomito|diarreia|refluxo|azia|palpitacao)\b/.test(
      text,
    )
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
    /\b(pressao|pontadas?|pulsando|pulsacao|lateja\w*|queimacao|constante|intermitente|vai e volta|todos os dias|quase todo dia|quase todos os dias|um lado|lado direito|lado esquerdo|descamando|bolhas?|manchas?|catarro|tosse seca|coriza|nariz entupido|congestao nasal|espirros?)\b/.test(
      text,
    )
  )
    known.add('pattern');

  if (
    /\b(febre|formigamento|dormencia|nausea|enjoo|vomito|sangramento|vermelhidao|vermelho|avermelhado|secrecao|coriza|espirros?|sem outros sintomas|sem outro sintoma|nenhum outro sintoma|nenhum outro sintomas|nao tenho outros sintomas|nao tem outros sintomas|nao apresenta outros sintomas|nao percebe outros sintomas|nao sinto mais nada|nao sente mais nada|nao tenho mais nada|nao tem mais nada|nada alem disso)\b/.test(
      text,
    )
  )
    known.add('associated_symptoms');

  if (
    /\b(piora|melhora|apos|depois (?:de|que)|desde que|quando (?:viro|mexo|uso)|ao movimentar|ao mexer|ao virar|ao caminhar|ao correr|depois de correr|apos correr|ao trabalhar|irradia|espalha|acordar)\b/.test(
      text,
    )
  )
    known.add('trigger');

  if (/\b(atrapalha|impede|consigo trabalhar|consigo dormir|consigo andar|atividades|rotina)\b/.test(text))
    known.add('impact');

  const patient = patientProfile(messages);
  if (patient.ageYears !== null || patient.adultReported) known.add('age_group');

  const descriptive = ['pattern', 'associated_symptoms', 'trigger', 'impact'].some((topic) =>
    known.has(topic as ClarificationTopic),
  );

  const contentWords =
    text
      .replace(
        /\b(?:eu|ele|ela|meu|minha|pai|mae|filha|filho|avo|neto|neta|esta|estou|com|uma?|de|no|na|e|que|muito|muita|forte|intensa|sentindo|tenho|tem|anos|onde|devo|levar|ir|qual|especialista|procurar|por|favor|agora)\b|\d+/g,
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

function ageQuestion(text: string) {
  if (/\bfilha\b/.test(text))
    return 'Qual é a idade da sua filha? Informe em anos ou, se for bebê, em meses.';
  if (/\bfilho\b/.test(text))
    return 'Qual é a idade do seu filho? Informe em anos ou, se for bebê, em meses.';
  if (/\b(?:minha|nossa) avo\b/.test(text))
    return 'Qual é a idade da sua avó? Informe em anos.';
  if (/\b(?:meu|nosso) avo\b/.test(text))
    return 'Qual é a idade do seu avô? Informe em anos.';
  if (/\bmae\b/.test(text)) return 'Qual é a idade da sua mãe? Informe em anos.';
  if (/\bpai\b/.test(text)) return 'Qual é a idade do seu pai? Informe em anos.';
  if (/\bneta\b/.test(text))
    return 'Qual é a idade da sua neta? Informe em anos ou, se for bebê, em meses.';
  if (/\bneto\b/.test(text))
    return 'Qual é a idade do seu neto? Informe em anos ou, se for bebê, em meses.';
  return 'Qual é a idade da pessoa com esse desconforto? Informe em anos ou, se for bebê, em meses.';
}

export function questionText(topic: ClarificationTopic, text: string) {
  const questions: Record<ClarificationTopic, string> = {
    location:
      'Em qual parte do corpo você sente o desconforto? Indique o local mais exato que conseguir.',
    onset_duration: 'Há quanto tempo isso começou? O início foi de repente ou aos poucos?',
    pattern:
      /\b(tontura|vertigem)\b/.test(normalize(text))
        ? 'Como é a tontura: sensação de que tudo está girando, desequilíbrio, sensação de desmaio ou outro tipo? Ela é constante ou acontece em crises?'
        : bodyRegion(text) === 'head'
          ? 'Em que região da cabeça a dor aparece e como ela é: pressão, pontadas, pulsação ou de outro jeito?'
          : bodyRegion(text) === 'neck'
            ? 'A dor fica só no pescoço ou se espalha para ombros ou braços? Ela muda ao movimentar o pescoço?'
            : 'Como é o desconforto? Ele é constante ou vai e volta?',
    associated_symptoms:
      'Além desse desconforto, você percebeu algum outro sintoma? Descreva quais, ou diga se não percebeu nenhum.',
    trigger: 'Você percebe algo que inicia, piora ou melhora o desconforto?',
    impact: 'Como o desconforto está afetando suas atividades e seu sono?',
    age_group: ageQuestion(text),
  };
  return questions[topic];
}

/**
 * Pick at most two useful questions. A previously asked but unanswered question may be retried once;
 * after that the pipeline proceeds to semantic routing/fallback instead of looping forever.
 */
export function clarificationQuestions(
  assessment: ReturnType<typeof assessDetail>,
  requested: ClarificationTopic[],
  previous?: NonNullable<ChatRequest['context']>['care'],
) {
  if ((previous?.round ?? 0) >= 3) return [];

  const asked = new Set(previous?.askedTopics ?? []);
  const candidates = requested.length ? requested : assessment.missing;

  return [...new Set(candidates)]
    .filter((topic) => {
      if (assessment.known.has(topic)) return false;
      if (!asked.has(topic)) return true;
      return (previous?.round ?? 0) < 2 && Boolean(previous?.questions.includes(topic));
    })
    .slice(0, 2);
}
