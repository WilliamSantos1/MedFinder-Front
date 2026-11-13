import { positiveEvidenceText } from './negated-evidence.js';

/**
 * Anatomical location is not an organ diagnosis. These are bounded, educational
 * referral hints for the LLM and a narrow ambiguity gate for cross-system areas.
 * The mappings describe POSSIBLE assessment destinations, not diseases or
 * probability estimates. Urgent signs are evaluated separately, before clinics.
 *
 * Sources: AAFP groin pain (2025), AAFP acute pelvic pain (2023), Merck Manual
 * acute abdominal pain (2024) and urologic evaluation (2026), NHS pelvic pain,
 * eyelid problems, eye pain, shoulder pain, CDC common cold.
 */
interface Area {
  id: string;
  name: string;
  match: RegExp;
  possibleSpecialties: readonly string[];
  distinguishBy: string;
  /** For strongly cross-system locations, don't infer a specialist from the site alone. */
  ambiguityGate?: true;
  /** Context supporting a more specific route. Match only positive evidence. */
  discriminating?: RegExp;
}

const areas: readonly Area[] = [
  { id: 'pubic-pelvic', name: 'púbis / região pélvica / baixo ventre / virilha',
    match: /\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica|supra pubica|pelve|pelvica|pelvico|baixo ventre|parte baixa da barriga|pe da barriga|bacia|virilha|inguinal|perineo)\b/,
    possibleSpecialties: ['clinica-medica', 'urologia', 'ortopedia', 'cirurgia-geral', 'ginecologia', 'gastroenterologia'],
    distinguishBy: 'intensidade, início, esforço/movimento, abaulamento, sintomas urinários, intestinais, reprodutivos e febre',
    ambiguityGate: true,
    discriminating: /\b(?:urinar|urina com sangue|ardencia (?:ao|para) urinar|disuria|jato urinario|bexiga|testiculo|prostata|menstrua\w*|vaginal|ovari\w*|uter\w*|gravidez|gestante|corrimento|diarreia|vomit\w*|evacuar|fezes|prisa[o]? de ventre|constipacao|corrid\w*|correr|trein\w*|academia|musculacao|exercicio|esforco|febre|calafrios?|levant\w* peso|carreg\w* peso|chute|pancada|queda|trauma|moviment\w*|caminh\w*|abaulamento|calombo|hernia|caroco|saliencia)\b/ },
  { id: 'axillary', name: 'axila', match: /\b(?:axila|axilas|embaixo do braco|debaixo do braco)\b/,
    possibleSpecialties: ['clinica-medica', 'dermatologia', 'mastologia', 'ortopedia'],
    distinguishBy: 'lesão de pele, nódulo/inchaço, febre, relação com movimento ou esforço e alterações mamárias',
    ambiguityGate: true,
    discriminating: /\b(?:manchas?|bolinhas?|ferid\w*|vermelh\w*|coceira|prurido|secrecao|pus|inflamad\w*|caroco|nodulo|linfonodo|ganglio|mama|seio|mamilo|trein\w*|academia|esforco|febre|calafrios?|levant\w* peso|carreg\w*|moviment\w*|pancada|trauma|queda)\b/ },
  { id: 'flank', name: 'flanco / lateral do abdome', match: /\b(?:flanco|lateral da barriga|lado da barriga|regiao lateral do abdomen)\b/,
    possibleSpecialties: ['clinica-medica', 'urologia', 'nefrologia', 'gastroenterologia', 'ortopedia'],
    distinguishBy: 'febre, urina, náuseas/vômitos, evacuação e relação com movimento/esforço',
    ambiguityGate: true,
    discriminating: /\b(?:ardencia (?:ao|para) urinar|disuria|sangue na urina|urina com sangue|urinando|vontade de urinar|febre|calafrio|vomit\w*|nausea|diarreia|evacuar|fezes|treino|exercicio|esforco|pancada|queda|moviment\w*|renal|rim|rins|calcul\w*)\b/ },
  { id: 'jaw', name: 'mandíbula / maxilar', match: /\b(?:mandibula|maxilar|queixo|dor no maxilar)\b/,
    possibleSpecialties: ['clinica-medica', 'otorrinolaringologia', 'ortopedia', 'cardiologia'],
    distinguishBy: 'dor no peito, falta de ar, suor frio, mastigação, boca/dentes e trauma',
    ambiguityGate: true,
    discriminating: /\b(?:peito|falta de ar|suor frio|palpita\w*|mastigar|mastigacao|dente|dentes|gengiva|abrir a boca|boca travada|pancada|queda|trauma|ouvido|incha\w*|caroco)\b/ },
  { id: 'eye', name: 'olho / visão', match: /\b(?:olhos?|ocular|visao|retina|cornea)\b/,
    possibleSpecialties: ['oftalmologia', 'clinica-medica', 'otorrinolaringologia'],
    distinguishBy: 'alteração visual, dor intensa, fotofobia, secreção e sinais respiratórios sistêmicos' },
  { id: 'eyelid', name: 'pálpebra', match: /\bpalpebras?\b/,
    possibleSpecialties: ['oftalmologia', 'clinica-medica', 'dermatologia'],
    distinguishBy: 'vermelhidão, calor, dor, febre, visão e velocidade do inchaço' },
  { id: 'ear', name: 'ouvido / orelha', match: /\b(?:ouvidos?|orelhas?|timpano)\b/,
    possibleSpecialties: ['otorrinolaringologia', 'clinica-medica', 'dermatologia'],
    distinguishBy: 'dor interna, audição, secreção, alteração de pele e início súbito' },
  { id: 'nose', name: 'nariz / seios da face', match: /\b(?:nariz|narinas?|seios da face|congestao nasal|coriza)\b/,
    possibleSpecialties: ['clinica-medica', 'otorrinolaringologia', 'alergologia-imunologia'],
    distinguishBy: 'febre, evolução, sintomas respiratórios, recorrência e exposição alérgica' },
  { id: 'throat', name: 'garganta / amígdalas', match: /\b(?:garganta|amigdal\w*|faringe|laringe)\b/,
    possibleSpecialties: ['clinica-medica', 'otorrinolaringologia', 'pediatria'],
    distinguishBy: 'febre, dificuldade de engolir/respirar, duração e idade real do paciente' },
  { id: 'neck', name: 'pescoço / nuca', match: /\b(?:pescoco|nuca|cervical)\b/,
    possibleSpecialties: ['clinica-medica', 'ortopedia', 'neurologia', 'otorrinolaringologia'],
    distinguishBy: 'trauma/movimento, febre e rigidez, alterações neurológicas e nódulos' },
  { id: 'shoulder', name: 'ombro / clavícula', match: /\b(?:ombro|ombros|clavicula)\b/,
    possibleSpecialties: ['ortopedia', 'clinica-medica', 'cardiologia'],
    distinguishBy: 'mecanismo, movimento/força, trauma, dor no peito, falta de ar e suor frio' },
  { id: 'chest', name: 'peito / tórax / costelas', match: /\b(?:peito|torax|toracica|costelas?|esterno)\b/,
    possibleSpecialties: ['clinica-medica', 'cardiologia', 'pneumologia', 'ortopedia', 'gastroenterologia'],
    distinguishBy: 'urgência cardiovascular/respiratória, respiração, esforço, movimento, trauma e digestão' },
  { id: 'breast', name: 'mama / mamilo', match: /\b(?:mamas?|mamilos?|areola|seios?(?!\s+da face))\b/,
    possibleSpecialties: ['mastologia', 'clinica-medica', 'ginecologia', 'dermatologia'],
    distinguishBy: 'nódulo, secreção, alteração de pele, febre e amamentação' },
  { id: 'back', name: 'coluna / costas', match: /\b(?:costas|coluna|lombar|sacro|sacral)\b/,
    possibleSpecialties: ['ortopedia', 'clinica-medica', 'neurologia', 'urologia'],
    distinguishBy: 'mecanismo, febre, urina, sintomas neurológicos e controle de esfíncteres' },
  { id: 'abdomen', name: 'abdome / umbigo / epigástrio', match: /\b(?:abdomen|barriga|umbigo|epigastrio|estomago)\b/,
    possibleSpecialties: ['clinica-medica', 'gastroenterologia', 'cirurgia-geral', 'urologia'],
    distinguishBy: 'intensidade, localização, febre, vômitos, trânsito intestinal, urina e gravidez quando aplicável' },
  { id: 'genital', name: 'genitais externos', match: /\b(?:glande|prepucio|penis|escroto|vulva|vagina)\b/,
    possibleSpecialties: ['urologia', 'ginecologia', 'dermatologia', 'clinica-medica'],
    distinguishBy: 'lesão de pele, secreção, dor, queixa urinária, febre e anatomia relevante, sem pressupor infecção' },
  { id: 'testicle', name: 'testículo', match: /\b(?:testiculo|testiculos|bolsa escrotal)\b/,
    possibleSpecialties: ['urologia', 'clinica-medica'],
    distinguishBy: 'dor súbita/intensa, inchaço, náuseas e trauma; urgência antes de consulta eletiva' },
  { id: 'arm-hand', name: 'braço / mão / dedos', match: /\b(?:braco|antebraco|cotovelo|punho|maos?|dedos?|unha|unhas?)\b/,
    possibleSpecialties: ['ortopedia', 'cirurgia-mao', 'dermatologia', 'neurologia', 'clinica-medica'],
    distinguishBy: 'mecanismo de trauma, movimento, sensibilidade, alterações cutâneas e circulação' },
  { id: 'leg', name: 'perna / panturrilha / coxa', match: /\b(?:perna|pernas|panturrilha|coxa)\b/,
    possibleSpecialties: ['ortopedia', 'cirurgia-vascular', 'neurologia', 'clinica-medica'],
    distinguishBy: 'inchaço unilateral, calor, cor, movimento, trauma e sintomas respiratórios' },
  { id: 'hip', name: 'quadril', match: /\b(?:quadril|quadris)\b/,
    possibleSpecialties: ['ortopedia', 'clinica-medica', 'ginecologia', 'urologia'],
    distinguishBy: 'trauma/esforço, movimento, irradiação, manifestações urinárias/abdominais' },
  { id: 'knee', name: 'joelho', match: /\b(?:joelhos?|patela|rotula)\b/,
    possibleSpecialties: ['ortopedia', 'reumatologia', 'clinica-medica'],
    distinguishBy: 'trauma, febre, calor/inchaço, limitação funcional e recorrência' },
  { id: 'ankle-foot', name: 'pé / tornozelo', match: /\b(?:tornozelos?|pes?|calcanhar|planta do pe)\b/,
    possibleSpecialties: ['ortopedia', 'cirurgia-vascular', 'neurologia', 'clinica-medica'],
    distinguishBy: 'trauma, apoio, ferida, sensibilidade, cor e circulação' },
  { id: 'skin', name: 'pele / cabelo / unha não traumática', match: /\b(?:pele|couro cabeludo|cabelos?|unhas?|cuticulas?)\b/,
    possibleSpecialties: ['dermatologia', 'clinica-medica', 'ortopedia'],
    distinguishBy: 'aspecto e duração da lesão, febre, trauma/esmagamento, sinais de infecção' },
  { id: 'head', name: 'cabeça / face', match: /\b(?:cabeca|rosto|face|testa)\b/,
    possibleSpecialties: ['clinica-medica', 'neurologia', 'otorrinolaringologia', 'oftalmologia'],
    distinguishBy: 'início súbito, sinais neurológicos, febre/rigidez e sintomas oculares/nasais' },
  { id: 'oral', name: 'boca / gengiva / língua', match: /\b(?:boca|gengiva|lingua|dentes?)\b/,
    possibleSpecialties: ['clinica-medica', 'otorrinolaringologia', 'cirurgia-cabeca-pescoco'],
    distinguishBy: 'local exato, lesão, infecção, dificuldade de engolir/respirar e necessidade de avaliação odontológica' },
];

const complaint = /\b(?:dor|dores|doendo|doi|dolorid\w*|desconforto|incomodo|ardencia|queimacao|inchaco|inchad\w*|caroco|nodulo|vermelh\w*|bolinhas?|pontad\w*|fisgad\w*)\b/;

export interface AnatomicalAssessment {
  /** Empty when there is no ambiguous, symptomatic cross-system area. */
  unresolved: boolean;
  areaId: string | null;
  // Keep the entire anatomy map out of every request: at most two matching hints.
  hints: Array<{ region: string; possibleSpecialties: string[]; distinguishBy: string }>;
}

export function assessAnatomicalDifferential(evidence: string): AnatomicalAssessment {
  const text = positiveEvidenceText(evidence);
  const matches = areas.filter((area) => area.match.test(text));
  const ambiguous = matches.find((area) => area.ambiguityGate && complaint.test(text) &&
    !(area.discriminating?.test(text) ?? false));
  return {
    unresolved: Boolean(ambiguous),
    areaId: ambiguous?.id ?? null,
    hints: matches.slice(0, 2).map((area) => ({
      region: area.name,
      possibleSpecialties: [...area.possibleSpecialties],
      distinguishBy: area.distinguishBy,
    })),
  };
}
