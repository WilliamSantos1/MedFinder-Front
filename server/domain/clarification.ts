import type { ChatRequest, ClarificationTopic } from '../../shared/contracts.js';
import { normalize } from './text.js';
import { hasVocabularyHealthTerm, hasVocabularyLocation, vocabularyDomains } from './clinical-vocabulary.js';
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
  ['abdomen', /\b(barriga|estomago|abdomen|abdominal|intestino|virilha|pelve|pelvica|pelvico|perineo|pe da barriga|bacia|pubis|baixo ventre|regiao inguinal)\b/],
  ['limbs', /\b(braco|bracos|perna|pernas|joelho|joelhos|ombro|ombros|mao|maos|pe|pes|tornozelo|tornozelos|quadril|quadris|cotovelo|cotovelos|punho|punhos|articulacao|articulacoes)\b/],
] as const;

const symptom =
  /\b(dor|dores|doi|doendo|doente|ardencia|coceira|cocando|cocar|desconforto|tosse|coriza|rinite|congestao|espirros?|vermelh\w*|manchas?|tontura|vertigem|febre|enjoo|nausea|vomito|diarreia|sangramento|formigamento|dormencia|fraqueza|cansaco|fadiga|inchaco|caroco|nodulo|refluxo|azia|palpitacao|insonia|ansiedade)\b/;

const clinicalDomains = [
  ['eye', /\b(olhos?|ocular|visao|vista|palpebra|cornea|retina|glaucoma|catarata)\b/],
  ['ent', /\b(ouvidos?|audicao|zumbido|nariz|sinusite|rinite|coriza|garganta|rouquidao)\b/],
  ['skin', /\b(pele|manchas?|erupcao|urticaria|coceira|prurido|acne|micose)\b/],
  [
    'musculoskeletal',
    /\b(joelho|ombro|tornozelo|quadril|cotovelo|punho|mao|dedos?|pe|pes|osso|ossos|articulacao|articulacoes|coluna|costas|lombar|pescoco|cervical|musculo|tendao|ligamento|entorse|fratura|luxacao)\b/,
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

function bodyRegion(value: string) {
  const text = normalize(value);
  const known = regions.find(([, pattern]) => pattern.test(text))?.[0];
  if (known) return known;
  const domains = vocabularyDomains(text);
  if (domains.includes('musculoskeletal')) return 'limbs';
  if (domains.includes('ent')) return 'airway';
  if (domains.includes('eye')) return 'eye';
  if (domains.includes('skin')) return 'skin';
  if (domains.includes('digestive')) return 'abdomen';
  if (domains.includes('urinary') || domains.includes('gynecologic')) return 'urinary';
  return undefined;
}

function complaintDomains(text: string) {
  const domains = new Set<ClinicalDomain>(
    clinicalDomains.filter(([, pattern]) => pattern.test(text)).map(([domain]) => domain),
  );
  const mapped = {
    musculoskeletal: 'musculoskeletal', ent: 'ent', digestive: 'digestive',
    neurologic: 'neurologic', skin: 'skin', eye: 'eye', urinary: 'urinary',
    gynecologic: 'gynecologic', respiratory: 'respiratory',
    cardiovascular: 'cardiovascular', endocrine: 'endocrine',
    blood: 'general', vascular: 'cardiovascular', breast: 'gynecologic',
    mental: 'mental', geriatric: 'general',
  } as const satisfies Record<ReturnType<typeof vocabularyDomains>[number], ClinicalDomain>;
  for (const item of vocabularyDomains(text)) domains.add(mapped[item]);
  return domains;
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

// A caregiver may answer an interview question in first person (e.g. 
// "começou ontem, não tenho outros sintomas"). It is not evidence
// that the patient changed from the child to the caregiver.
function caregiverClinicalAnswer(text: string) {
  return /\b(?:nao\s+(?:tenho|sinto|percebi|notei)\s+(?:(?:mais|outros?|outras?)\s+)*(?:sintomas?|sinais?|queixas?)|sem\s+outros?\s+(?:sintomas?|sinais?))\b/.test(text) &&
    !/\b(?:agora\s+(?:sou eu|comigo)|eu\s+estou\s+com\s+(?:dor|febre)|estou\s+com\s+(?:dor|febre))\b/.test(text);
}

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
        Boolean(explicitSubject && previous.subject && explicitSubject !== previous.subject &&
          !(explicitSubject === 'self' && caregiverClinicalAnswer(text) && previous.subject !== 'self')));

    // A neurological/urinary warning sign may arrive after a previously
    // discussed back-pain complaint. Do not split the episode before safety
    // combines these clinically relevant messages.
    const backWarningFollowup =
      /\b(?:formigamento|dormencia|fraqueza|nao consigo urinar|nao consegue urinar|perdi o controle da urina|perda de sensibilidade)\b/.test(text) &&
      previous.messages.some((entry) => /\b(?:dor nas costas|dor lombar)\b/.test(normalize(entry)));
    const freshIndependentComplaint = Boolean(
      !backWarningFollowup && !continuationCue.test(text) &&
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
        (currentSubject && previousSubject && currentSubject !== previousSubject &&
          !(currentSubject === 'self' && previousSubject !== 'self' &&
            caregiverClinicalAnswer(current) && Boolean(request.context?.care?.questions.length)))),
  );

  const explicitNewComplaint = explicitNewComplaintCue.test(current);
  const looksLikeFreshComplaint = freshComplaintCue.test(current) && !continuationCue.test(current);
  const latestDomains = latest?.domains ?? new Set<ClinicalDomain>();

  const pendingInterviewReply = Boolean(request.context?.care?.questions.length);
  const backWarningFollowup =
    /\b(?:formigamento|dormencia|fraqueza|nao consigo urinar|nao consegue urinar|perdi o controle da urina|perda de sensibilidade)\b/.test(current) &&
    latest?.messages.some((entry) => /\b(?:dor nas costas|dor lombar)\b/.test(normalize(entry)));
  const domainChanged = Boolean(
    !newPerson && !pendingInterviewReply && !backWarningFollowup &&
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
    !newPerson && !pendingInterviewReply && !backWarningFollowup &&
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
    hasVocabularyLocation(text) ||
    hasVocabularyHealthTerm(text) ||
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
    ) ||
    /\b(?:ha|faz|durante|por)\s+(?:varios?\s+|muitas?\s+|algumas?\s+)?(?:dias?|semanas?|meses|anos)\b/.test(text) ||
    /\b(?:desde a semana passada|desde o mes passado|ha muito tempo|ha bastante tempo)\b/.test(text)
  )
    known.add('onset_duration');

  if (
    /\b(pressao|pontadas?|pulsando|pulsacao|lateja\w*|queimacao|constante|intermitente|vai e volta|todos os dias|quase todo dia|quase todos os dias|fica da mesma forma|nao piora|sempre igual|um lado|lado direito|lado esquerdo|descamando|bolhas?|manchas?|catarro|tosse seca|coriza|nariz entupido|congestao nasal|espirros?)\b/.test(
      text,
    )
  )
    known.add('pattern');

  if (
    /\b(febre|formigamento|dormencia|nausea|enjoo|vomito|sangramento|ardencia ao urinar|ardencia para urinar|dor ao urinar|dificuldade para urinar|sangue na urina|urina com sangue|jato urinario|sangue nas fezes|diarreia|corrimento vaginal|abaulamento|calombo|caroco|vermelhidao|vermelho|avermelhado|secrecao|coriza|espirros?|sem outros sintomas|sem mais sintomas|sem outro sintoma|sem outros sinais|sem mais sinais|somente essa dor|somente esta dor|apenas essa dor|apenas esta dor|so essa dor|so esta dor|so sinto essa dor|sinto apenas a dor|apenas uma dor|apenas a dor|somente a dor|so dor|sem dificuldade|sem inchaco|sem formigamento|sem dormencia|somente esse sintoma|somente este sintoma|somente esse|somente isso|so esse|so isso|nao somente esse|nao so esse|apenas esse sintoma|apenas este sintoma|apenas isso|sem nenhum outro|sem mais nenhum|nenhum outro|nenhuma outra|nao percebi nenhum|nao percebi nenhuma|nada mais|nao tenho nada disso|nenhum outro sintoma|nenhum outro sintomas|nao tenho outros sintomas|nao tem outros sintomas|nao apresenta outros sintomas|nao percebe outros sintomas|nao sinto mais nada|nao sente mais nada|nao tenho mais nada|nao tem mais nada|nada alem disso|nao percebi mais nada|nao sinto nada alem da dor)\b/.test(
      text,
    )
  )
    known.add('associated_symptoms');

  if (
    /\b(piora|melhora|apos|depois (?:de|da|do|que)|desde que|quando (?:viro|mexo|uso)|ao movimentar|ao mexer|ao virar|ao caminhar|ao correr|depois de correr|apos correr|ao trabalhar|irradia|espalha|acordar|queda|cai|pancada|academia|corrida|treino|exercicio|esforco|pisei errado|torci|levantar|levantou|levantando|erguer|ergueu|carregar|carregou|segurar peso|pegou peso|puxar|puxou|empurrar|empurrou|sem trauma|sem queda|sem esforco|sem causa clara)\b/.test(
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
            : /\b(?:virilha|pelve|pelvica|pelvico|perineo|pe da barriga|bacia|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica)\b/.test(normalize(text))
            ? 'A dor ou o espasmo fica na virilha, no baixo ventre ou em outra parte da pelve? É contínuo ou vem em crises?'
            : 'Como é o desconforto? Ele é constante ou vai e volta?',
    associated_symptoms:
      /\b(?:palpebras?|olhos?|ocular|visao)\b/.test(normalize(text)) &&
      /\b(?:inchaco|inchad\w*|vermelh\w*|avermelhad\w*|dor|ardor|ardencia|coc\w*)\b/.test(normalize(text))
        ? 'Além da alteração nas pálpebras/olhos, há dor dentro do olho, mudança na visão, sensibilidade à luz, febre ou piora rápida do inchaço? Se não houver, diga que não.'
      : /\b(?:perna|pernas|panturrilha|coxa)\b/.test(normalize(text)) &&
        /\b(?:dor|doendo|dolorid\w*)\b/.test(normalize(text))
        ? 'A perna está inchada, principalmente de um lado, quente ou avermelhada? Há falta de ar, dor no peito, dormência ou fraqueza? Se não houver, diga que não.'
      : /\b(?:disenteria|desinteria|disinteria|dissenteria|diarreia|fezes liquidas|intestino solto)\b/.test(normalize(text))
        ? 'Além da alteração intestinal, há sangue nas fezes, febre, vômitos, dor forte ou sinais de desidratação (pouca urina, tontura ou dificuldade para beber)? Diga quais ou responda que não.'
      : bodyRegion(text) === 'back'
        ? 'Além da dor nas costas, há fraqueza ou dormência nas pernas, febre ou alteração para urinar/evacuar? Se não houver, diga que não. Se houver perda de controle da urina/fezes ou perda de sensibilidade genital, procure emergência imediatamente.'
        : bodyRegion(text) === 'limbs'
          ? /\b(?:quadril|quadris)\b/.test(normalize(text))
            ? 'Além da dor no quadril, você percebe inchaço, fraqueza, dormência, febre ou dificuldade para caminhar ou movimentar a perna? Se não houver, diga que não.'
            : /\b(?:ombro|ombros|braco|bracos|clavicula)\b/.test(normalize(text))
              ? 'Além da dor no ombro/braço/clavícula, há dor ou aperto no peito, falta de ar, suor frio, fraqueza, dormência, inchaço ou dificuldade para movimentar o braço? Se não houver, diga que não.'
              : /\b(?:pe|pes|tornozelo|tornozelos)\b/.test(normalize(text))
                ? 'Além da dor, há inchaço, vermelhidão, dormência ou dificuldade para apoiar o pé e caminhar? Se não houver, diga que não.'
                : 'Além da dor, há inchaço, vermelhidão, dormência, fraqueza ou dificuldade para movimentar a região afetada? Se não houver, diga que não.'
          : /\b(?:virilha|pelve|pelvica|pelvico|perineo|pe da barriga|bacia|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica)\b/.test(normalize(text))
            ? 'Além da dor no púbis/pelve/virilha, há febre, ardência ou dificuldade para urinar, alteração intestinal, sangramento, abaulamento ou outro sintoma? Se não, diga que não.'
            : 'Além desse desconforto, você percebeu algum outro sintoma? Descreva quais, ou diga se não percebeu nenhum.',
    trigger:
      /\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica|pelve|pelvica|pelvico|virilha|inguinal|baixo ventre|perineo)\b/.test(normalize(text))
        ? 'A dor começou após exercício, esforço, pancada ou queda? Piora ao caminhar/movimentar ou apareceu sem causa clara?'
      : bodyRegion(text) === 'back' || bodyRegion(text) === 'limbs'
        ? 'A dor surgiu após queda, pancada, exercício ou esforço? Ela piora com algum movimento ou apareceu sem causa clara?'
        : 'Você percebe algo que inicia, piora ou melhora o desconforto?',
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

  for (const answered of previous?.answeredTopics ?? []) assessment.known.add(answered);
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
