import { normalize } from './text.js';

export interface ClinicalGuidance {
  id: string;
  title: string;
  sourceUrl: string;
  summary: string;
}

/**
 * Small, deliberately bounded collection of publicly available referral guidance.
 * This is a source retrieval layer, NOT a validated diagnostic knowledge base.
 * Adding new domains requires review of the source and clinical validation.
 */
const guidance: ReadonlyArray<ClinicalGuidance & { matches: RegExp }> = [
  {
    id: 'nhs-eyelid-problems',
    title: 'NHS — Eyelid problems: urgent signs',
    sourceUrl: 'https://www.nhs.uk/symptoms/eyelid-problems/',
    summary: 'Pálpebras inchadas exigem avaliação dos sinais associados. Vermelhidão com calor/dor, febre, dificuldade para abrir o olho ou alteração visual merecem avaliação rápida; a simples palavra pálpebra não indica doença específica.',
    matches: /\b(?:palpebras?|inchaco (?:no|nos) olhos?)\b/,
  },
  {
    id: 'aha-chest-pain-equivalents',
    title: 'American Heart Association — 2021 Chest Pain Guideline',
    sourceUrl: 'https://professional.heart.org/en/science-news/2021-guideline-for-the-evaluation-and-diagnosis-of-chest-pain/top-things-to-know',
    summary: 'Na avaliação da dor no ombro/braço/clavícula, verificar sintomas torácicos, dispneia e outros sinais sistêmicos quando pertinente. Dor em ombro ou braço pode acompanhar condições não musculoesqueléticas; não atribuir a Ortopedia exclusivamente pela localização.',
    matches: /\b(?:ombro|ombros|braco|bracos|clavicula)\b/,
  },
  {
    id: 'nhs-leg-unilateral-swelling',
    title: 'NHS — Deep vein thrombosis: symptoms and urgent care',
    sourceUrl: 'https://www.nhs.uk/conditions/deep-vein-thrombosis-dvt/',
    summary: 'Dor e inchaço de uma só perna podem ter causa vascular importante e exigem avaliação urgente. A presença adicional de falta de ar ou dor no peito exige atendimento de emergência. Não assumir que toda dor na perna é ortopédica.',
    matches: /\b(?:perna|panturrilha)\b/,
  },
  {
    id: 'medlineplus-crushed-finger',
    title: 'MedlinePlus — Smashed fingers: when to seek medical help',
    sourceUrl: 'https://medlineplus.gov/ency/article/000018.htm',
    summary: 'Prensamento/esmagamento do dedo e lesão da unha exigem avaliar mecanismo, movimento e sensibilidade. Dificuldade para movimentar, deformidade ou perda de sensibilidade justificam avaliação presencial rápida. Não classificar como Dermatologia apenas pela palavra unha.',
    matches: /\b(?:prensad\w*|imprensad\w*|prensou|imprensou|esmagad\w*|prensamento|imprensamento)\b/,
  },
  {
    id: 'nice-acutely-inflamed-joint',
    title: 'NICE NG219 — Painful red swollen joint: consider urgent evaluation',
    sourceUrl: 'https://www.nice.org.uk/guidance/ng219/chapter/Recommendations',
    summary: 'Uma articulação dolorosa, avermelhada, quente e inchada requer atenção para causas graves. Não tratar como simples lesão de pele ou consulta eletiva sem verificar urgência.',
    matches: /\b(?:articulacao|joelho|tornozelo|punho|quadril)\b.{0,90}\b(?:inchad\w*|inchaco|vermelh\w*|quente)\b/,
  },
  {
    id: 'nice-sudden-hearing-loss',
    title: 'NICE NG98 — Sudden hearing loss: rapid specialist assessment',
    sourceUrl: 'https://www.nice.org.uk/guidance/ng98/chapter/recommendations',
    summary: 'Perda súbita da audição pode demandar avaliação otorrinolaringológica em até 24 horas; não usar a busca rotineira de clínicas como substituto.',
    matches: /\b(?:surdez subita|perda de audicao|nao consigo ouvir|parei de ouvir)\b/,
  },
  {
    id: 'nhs-testicular-pain',
    title: 'NHS — Testicle pain: urgent symptoms',
    sourceUrl: 'https://www.nhs.uk/symptoms/testicle-pain/',
    summary: 'Dor testicular súbita e intensa é possível situação urgente e requer atendimento de emergência, não indicação eletiva de Urologia.',
    matches: /\b(?:testiculos?|escroto|bolsa escrotal)\b/,
  },
  {
    id: 'qld-diarrhea-referral',
    title: 'Queensland Health — Diarrhoea: prioritisation criteria',
    sourceUrl: 'https://www.health.qld.gov.au/cpc/gastroenterology/diarrhoea',
    summary: 'Diarreia pode ter avaliação inicial geral ou gastroenterológica conforme evolução. Desidratação importante ou sangramento intenso exigem avaliação mais rápida; não deduzir uma doença específica.',
    matches: /\b(?:diarreia|disenteria|desinteria|fezes liquidas)\b/,
  },
  {
    id: 'cdc-upper-airway-systemic',
    title: 'CDC — Common Cold / Respiratory Illnesses: signs and symptoms',
    sourceUrl: 'https://www.cdc.gov/common-cold/about/',
    summary: 'O CDC descreve coriza, congestão nasal, sintomas de garganta e febre baixa entre os sinais possíveis de infecções respiratórias, sem permitir diagnosticar uma doença apenas pelos sintomas. Em relato com manifestações respiratórias e sistêmicas, avaliar o conjunto e possíveis sinais de gravidade; isso não determina uma especialidade oficialmente pelo CDC.',
    matches: /\b(?:coriza|nariz entupido|congestao nasal|nariz congestionado|tosse|garganta)\b/,
  },
  {
    id: 'cdc-ocular-respiratory',
    title: 'CDC — Conjunctivitis: signs and symptoms',
    sourceUrl: 'https://www.cdc.gov/conjunctivitis/signs-symptoms/',
    summary: 'O CDC informa que ardência e irritação ocular podem ocorrer em quadros oculares, inclusive junto de infecções respiratórias. Dor ocular, sensibilidade à luz, visão embaçada ou vermelhidão intensa pedem avaliação profissional. A simples ardência não deve determinar Oftalmologia quando predominam sintomas respiratórios e febre.',
    matches: /\b(?:ardencia.*olh|olh.*ardend|irritacao ocular|olho vermelho|olhos vermelhos|dor ocular|visao emba[cç]ada)\b/,
  },
  {
    id: 'ms-dor-lombar',
    title: 'Ministério da Saúde — Dor lombar: avaliação e conduta',
    sourceUrl: 'https://linhasdecuidado.saude.gov.br/portal/dor-lombar/unidade-hospitalar/avaliacao-conduta/',
    summary: 'Na avaliação inicial de dor lombar, investigar duração, intensidade, trauma e sinais de alerta como perda de força, alteração de sensibilidade, perda de controle urinário ou intestinal e suspeita de infecção. Havendo suspeita de emergência, não encaminhar a consulta eletiva.',
    matches: /\b(?:costas|lombar|coluna)\b/,
  },
  {
    id: 'nhs-foot-pain',
    title: 'NHS — Pain in the bottom of the foot',
    sourceUrl: 'https://www.nhs.uk/symptoms/foot-pain/pain-in-the-bottom-of-the-foot/',
    summary: 'Em dor no pé, investigar localização, trauma, intensidade, capacidade de andar/apoiar, alteração de forma e sintomas neurológicos. Dor importante, incapacidade de caminhar ou deformidade merecem avaliação presencial urgente.',
    matches: /\b(?:pe|pes|calcanhar|sola|tornozelo)\b/,
  },
  {
    id: 'nice-neurology',
    title: 'NICE NG127 — Recognition and referral of neurological symptoms',
    sourceUrl: 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults-aged-over-16',
    summary: 'Para tontura e sintomas neurológicos, diferenciar sensação de rotação, desequilíbrio e pré-síncope e verificar sintomas neurológicos de início súbito. Fraqueza súbita focal e outras alterações neurológicas agudas requerem investigação urgente.',
    matches: /\b(?:tontura|vertigem|desequilibrio|desmaio)\b/,
  },
];

/** Retrieve relevant reference excerpts for the CURRENT clinical episode only. */
export function retrieveClinicalGuidance(messages: string[]): ClinicalGuidance[] {
  const text = normalize(messages.join(' '));
  return guidance
    .filter((item) => item.matches.test(text))
    .slice(0, 2)
    .map(({ id, title, sourceUrl, summary }) => ({ id, title, sourceUrl, summary }));
}
