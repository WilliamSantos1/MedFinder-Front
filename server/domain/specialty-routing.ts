import type { ClarificationTopic } from '../../shared/contracts.js';
import type { PatientProfile } from './patient.js';
import { normalize } from './text.js';

export interface RoutingCandidate {
  id: string;
  score: number;
  reason: string;
}

export interface ComplaintRouting {
  candidates: RoutingCandidate[];
  deterministicId: string | null;
  fallbackId: string;
  needsClarification: boolean;
  clarificationTopics: ClarificationTopic[];
  confidence: 'high' | 'medium' | 'fallback';
  healthComplaint: boolean;
  socialOnly: boolean;
}

type WeightedPattern = readonly [
  RegExp,
  number,
  string,
];

type Rule = {
  id: string;
  patterns: WeightedPattern[];
};

/**
 * Patient-facing routing vocabulary.
 *
 * This is deliberately a NAVIGATION taxonomy, not a diagnosis table.
 * Patterns describe body systems, already-known conditions and common
 * complaint vocabulary that can point to a reasonable first specialty.
 *
 * Emergency rules run before this module.
 *
 * High-confidence matches are resolved locally (fast path).
 * Overlapping/weak matches are sent as a short list to the configured LLM.
 *
 * If neither path resolves, Clínica Médica or Pediatria remains the
 * broad entry point so a recognizable health complaint never ends
 * in the old "não consegui validar" dead-end.
 */
const rules: Rule[] = [
  {
    id: 'oftalmologia',
    patterns: [
      [
        /\b(olhos?|ocular|visao|vista|palpebras?|cornea|retina|glaucoma|catarata|estrabismo|lacrimej\w*|pterigio)\b/,
        13,
        'olhos/visão',
      ],
      [
        /\b(conjuntiv\w*|fotofobia|moscas volantes|pontos pretos na visao|olho seco|olhos secos)\b/,
        10,
        'sintoma ocular',
      ],
    ],
  },

  {
    id: 'otorrinolaringologia',
    patterns: [
      [
        /\b(ouvidos?|audicao|timpano|zumbido|surdez|otite|labirintite|vertigem posicional)\b/,
        12,
        'ouvido/audição',
      ],
      [
        /\b(garganta|amigdal\w*|rouquidao|voz rouca|sinusite|sinus|desvio de septo|adenoide)\b/,
        11,
        'nariz/garganta/voz',
      ],
      [
        /\b(nariz|coriza|congestao nasal|nariz entupido|rinite|espirros?)\b/,
        7,
        'nariz',
      ],
      [
        /\b(tontura|vertigem)\b/,
        5,
        'equilíbrio/ouvido interno',
      ],
    ],
  },

  {
    id: 'alergologia-imunologia',
    patterns: [
      [
        /\b(alergia|alergico|alergica|alergista|imunologia|imunologista|imunidade|imunodeficiencia)\b/,
        12,
        'alergia/imunidade',
      ],
      [
        /\b(urticaria|rinite alergica|asma alergica|alergia alimentar)\b/,
        10,
        'quadro alérgico',
      ],
      [
        /\b(rinite|espirros?|coceira no nariz|coriza recorrente)\b/,
        6,
        'sintomas alérgicos',
      ],
    ],
  },

  {
    id: 'dermatologia',
    patterns: [
      [
        /\b(pele|dermat\w*|acne|espinhas?|micose|verrugas?|psoriase|eczema|caspa|queda de cabelo|cabelo (?:esta )?caindo|alopecia|unha encravada|unhas?|melasma)\b/,
        12,
        'pele/cabelos/unhas',
      ],
      [
        /\b(manchas?|erupcao|ferida na pele|descamacao|bolhas?|lesao de pele)\b/,
        5,
        'alteração cutânea',
      ],
      [
        /\b(coceira|cocando|prurido)\b/,
        6,
        'coceira/prurido com possível origem cutânea',
      ],
    ],
  },

  {
    id: 'ortopedia',
    patterns: [
      [
        /(?:\b(?:dor|doendo|dolorid\w*|trauma|batida|bati|machuquei|pancada|lesao|inchaco|inchad\w*|rigidez|estalo|instabilidade|dificuldade (?:para|de) movimentar)\b.{0,45}\b(?:joelho|ombro|tornozelo|quadril|cotovelo|punho|mao|dedos?|pe|pes|osso|ossos|articulacao|articulacoes|coluna|lombar|pescoco|cervical|musculo|tendao|ligamento)\b)|(?:\b(?:joelho|ombro|tornozelo|quadril|cotovelo|punho|mao|dedos?|pe|pes|osso|ossos|articulacao|articulacoes|coluna|lombar|pescoco|cervical|musculo|tendao|ligamento)\b.{0,45}\b(?:dor|doendo|dolorid\w*|trauma|batida|bati|machuquei|pancada|lesao|inchaco|inchad\w*|rigidez|estalo|instabilidade|movimento)\b)/,
        12,
        'queixa musculoesquelética localizada',
      ],
      [
        /\b(joelho|ombro|tornozelo|quadril|cotovelo|punho|mao|dedos?|pe|pes|osso|ossos|articulacao|articulacoes|coluna|lombar|pescoco|cervical|musculo|tendao|ligamento)\b/,
        5,
        'região musculoesquelética',
      ],
      [
        /\b(entorse|fratura|luxacao|lesao esportiva|tendinite|bursite|escoliose|artrose|hernia de disco)\b/,
        11,
        'lesão musculoesquelética',
      ],
    ],
  },

  {
    id: 'neurologia',
    patterns: [
      [
        /\b(enxaqueca|cefaleia|dor de cabeca|cabeca doendo|tremor|formigamento|dormencia|convuls\w*|epilepsia|parkinson|alzheimer|esclerose multipla|neuropatia|neurolog\w*)\b/,
        11,
        'sistema neurológico',
      ],
      [
        /\b(memoria|esquecimento|equilibrio|tontura|vertigem)\b/,
        5,
        'sintoma neurológico possível',
      ],
    ],
  },

  {
    id: 'cardiologia',
    patterns: [
      [
        /\b(coracao|cardio\w*|palpitacao|palpitacoes|arritmia|pressao alta|hipertensao|hipertenso|hipertensa|batimento acelerado|taquicardia|bradicardia|insuficiencia cardiaca)\b/,
        12,
        'coração/pressão',
      ],
      [
        /\b(inchaco nas pernas|edema nas pernas)\b/,
        4,
        'sintoma cardiovascular possível',
      ],
    ],
  },

  {
    id: 'pneumologia',
    patterns: [
      [
        /\b(pulmao|pulmoes|pneumo\w*|asma|bronquite|enfisema|dpoc|chiado|respiratorio|respiratoria|apneia do sono)\b/,
        12,
        'pulmões/respiração',
      ],
      [
        /\b(toss\w*|catarro|falta de ar aos esforcos)\b/,
        6,
        'sintoma respiratório',
      ],
    ],
  },

  {
    id: 'gastroenterologia',
    patterns: [
      [
        /\b(estomago|abdomen|abdominal|barriga|intestino|digestao|digestivo|refluxo|azia|gastrite|figado|hepat\w*|vesicula|pancreas|doenca de crohn|retocolite)\b/,
        11,
        'sistema digestivo',
      ],
      [
        /\b(nausea|enjoo|vomito|diarreia|constipacao|prisao de ventre|estufamento)\b/,
        5,
        'sintoma gastrointestinal',
      ],
    ],
  },

  {
    id: 'coloproctologia',
    patterns: [
      [
        /\b(hemorroida|hemorroidas|anus|anal|reto|retal|fissura anal|fistula anal|proctolog\w*)\b/,
        13,
        'região anal/retal',
      ],
      [
        /\b(sangue nas fezes|sangramento retal)\b/,
        9,
        'sangramento retal',
      ],
    ],
  },

  {
    id: 'urologia',
    patterns: [
      [
        /\b(prostata|testiculo|testiculos|penis|erecao|disfuncao eretil|urolog\w*|vasectomia)\b/,
        13,
        'sistema urológico masculino',
      ],
      [
        /\b(urinar|urina|bexiga|ardencia ao urinar|jato urinario|incontinencia urinaria|sangue na urina|infeccao urinaria)\b/,
        8,
        'trato urinário',
      ],
      [
        /\b(pedra nos rins|calculo renal|colica renal)\b/,
        9,
        'cálculo urinário',
      ],
    ],
  },

  {
    id: 'nefrologia',
    patterns: [
      [
        /\b(rim|rins|renal|creatinina|proteinuria|dialise|hemodialise|insuficiencia renal|doenca renal|sindrome nefrotica)\b/,
        13,
        'rins/função renal',
      ],
      [
        /\b(edema|inchaco generalizado)\b/,
        4,
        'sintoma renal possível',
      ],
    ],
  },

  {
    id: 'endocrinologia',
    patterns: [
      [
        /\b(tireoide|hipotireoidismo|hipertireoidismo|diabetes|glicose|glicemia|insulina|hormonio|hormonal|metabolismo|endocrino\w*)\b/,
        12,
        'hormônios/metabolismo',
      ],
      [
        /\b(obesidade|ganho de peso|perda de peso inexplicada)\b/,
        6,
        'alteração metabólica',
      ],
    ],
  },

  {
    id: 'nutrologia',
    patterns: [
      [
        /\b(nutrolog\w*|deficiencia de vitamina|vitaminas|desnutricao|nutricao clinica|sarcopenia)\b/,
        11,
        'nutrição clínica',
      ],
      [
        /\b(emagrecer|engordar|peso corporal|alimentacao)\b/,
        4,
        'peso/alimentação',
      ],
    ],
  },

  {
    id: 'ginecologia',
    patterns: [
      [
        /\b(vagina|vaginal|vulva|utero|ovario|ovarios|menstruacao|menstrual|menopausa|corrimento|gineco\w*|obstetric\w*|gestante|gravidez|parto|fertilidade feminina|endometriose|mioma)\b/,
        12,
        'saúde ginecológica/obstétrica',
      ],
      [
        /\b(colica menstrual|atraso menstrual|sangramento vaginal)\b/,
        9,
        'sintoma ginecológico',
      ],
    ],
  },

  {
    id: 'mastologia',
    patterns: [
      [
        /\b(mama|mamas|seio|seios|mamilo|nodulo na mama|caroco na mama|mastolog\w*)\b/,
        13,
        'mamas',
      ],
    ],
  },

  {
    id: 'hematologia',
    patterns: [
      [
        /\b(anemia|plaqueta|plaquetas|hemofilia|coagulacao|hematolog\w*|hemoterapia|leucemia|linfoma|talassemia)\b/,
        12,
        'sangue/coagulação',
      ],
      [
        /\b(hematomas frequentes|roxos sem motivo)\b/,
        6,
        'alteração hematológica possível',
      ],
    ],
  },

  {
    id: 'reumatologia',
    patterns: [
      [
        /\b(lupus|reumato\w*|artrite reumatoide|fibromialgia|doenca autoimune|autoimune|gota|espondilite|vasculite)\b/,
        12,
        'doença reumatológica/autoimune',
      ],
      [
        /\b(dor em varias articulacoes|dores articulares difusas|rigidez matinal)\b/,
        9,
        'dor articular sistêmica',
      ],
    ],
  },

  {
    id: 'infectologia',
    patterns: [
      [
        /\b(hiv|aids|tuberculose|hepatite viral|infectologista|infectologia|infeccoes recorrentes|doenca infecciosa|dengue|chikungunya|zika)\b/,
        11,
        'doença infecciosa',
      ],
      [
        /\b(febre recorrente sem causa|febre prolongada)\b/,
        6,
        'síndrome infecciosa possível',
      ],
    ],
  },

  {
    id: 'oncologia-clinica',
    patterns: [
      [
        /\b(cancer|oncologia|oncologista|quimioterapia|tumor maligno|neoplasia|metastase)\b/,
        13,
        'oncologia',
      ],
    ],
  },

  {
    id: 'psiquiatria',
    patterns: [
      [
        /\b(depressao|ansiedade|crise de panico|panico|transtorno bipolar|bipolar|psicose|alucinacao|mania|psiquiatr\w*|toc|tdah|transtorno alimentar)\b/,
        11,
        'saúde mental',
      ],
      [
        /\b(insonia|irritabilidade|humor)\b/,
        5,
        'sintoma de saúde mental',
      ],
    ],
  },

  {
    id: 'geriatria',
    patterns: [
      [
        /\b(geriatra|geriatria|fragilidade|quedas frequentes|polifarmacia|idoso fragil|idosa fragil)\b/,
        12,
        'saúde da pessoa idosa',
      ],
      [
        /\b(memoria|esquecimento)\b/,
        4,
        'cognição em pessoa idosa',
      ],
    ],
  },

  {
    id: 'cirurgia-vascular',
    patterns: [
      [
        /\b(varizes|cirurgia vascular|cirurgiao vascular|ferida venosa|ulcera venosa|circulacao nas pernas|trombose conhecida|doenca arterial periferica)\b/,
        11,
        'circulação/vasos',
      ],
      [
        /\b(inchaco de uma perna|dor na panturrilha)\b/,
        5,
        'sintoma vascular possível',
      ],
    ],
  },

  {
    id: 'cirurgia-geral',
    patterns: [
      [
        /\b(hernia|cirurgia geral|cirurgiao geral|apendice|apendicite conhecida|pedra na vesicula|calculo biliar|lipoma para retirar)\b/,
        11,
        'avaliação cirúrgica geral',
      ],
    ],
  },

  {
    id: 'genetica-medica',
    patterns: [
      [
        /\b(genetica|genetico|genetica medica|hereditario|hereditaria|doenca hereditaria|sindrome congenita|malformacao congenita|aconselhamento genetico)\b/,
        12,
        'genética/hereditariedade',
      ],
    ],
  },

  {
    id: 'medicina-fisica-reabilitacao',
    patterns: [
      [
        /\b(fisiatria|fisiatra|medicina fisica|reabilitacao medica|reabilitar|sequela neurologica|sequela motora|espasticidade)\b/,
        11,
        'reabilitação',
      ],
    ],
  },

  {
    id: 'medicina-esportiva',
    patterns: [
      [
        /\b(medicina esportiva|medico do esporte|performance esportiva|atleta|retorno ao esporte|avaliacao esportiva)\b/,
        10,
        'esporte',
      ],
    ],
  },

  {
    id: 'cirurgia-cabeca-pescoco',
    patterns: [
      [
        /(?:\b(?:caroco|nodulo|massa|tumor|aumento)\b.{0,35}\b(?:pescoco|garganta|tireoide|salivar|parotida)\b)|(?:\b(?:pescoco|tireoide|parotida|glandula salivar)\b.{0,35}\b(?:caroco|nodulo|massa|tumor)\b)/,
        11,
        'massa/nódulo em cabeça e pescoço',
      ],
      [
        /\b(cirurgia de cabeca e pescoco|cirurgiao de cabeca e pescoco|tumor de cabeca e pescoco)\b/,
        13,
        'cirurgia de cabeça e pescoço',
      ],
    ],
  },

  {
    id: 'cirurgia-mao',
    patterns: [
      [
        /\b(dedo em gatilho|sindrome do tunel do carpo|tunel do carpo|contratura de dupuytren|cirurgia da mao|cirurgiao da mao)\b/,
        12,
        'mão/punho com possível avaliação cirúrgica especializada',
      ],
    ],
  },

  {
    id: 'cirurgia-cardiovascular',
    patterns: [
      [
        /\b(cirurgia cardiovascular|cirurgiao cardiovascular|cirurgia cardiaca|ponte de safena|revascularizacao miocardica|troca de valvula|cirurgia de valvula|aneurisma de aorta)\b/,
        16,
        'cirurgia cardiovascular',
      ],
    ],
  },

  {
    id: 'cirurgia-aparelho-digestivo',
    patterns: [
      [
        /\b(cirurgia do aparelho digestivo|cirurgiao do aparelho digestivo|cirurgia digestiva|cirurgiao digestivo|cirurgia bariatrica)\b/,
        13,
        'cirurgia do aparelho digestivo',
      ],
    ],
  },

  {
    id: 'cirurgia-oncologica',
    patterns: [
      [
        /\b(cirurgia oncologica|cirurgiao oncologico|cirurgia do cancer|operar tumor|retirar tumor maligno)\b/,
        16,
        'cirurgia oncológica',
      ],
    ],
  },

  {
    id: 'cirurgia-plastica',
    patterns: [
      [
        /\b(cirurgia plastica|cirurgiao plastico|reconstrucao apos queimadura|reconstrucao de mama|cicatriz para corrigir|queloide)\b/,
        12,
        'cirurgia plástica/reconstrutiva',
      ],
    ],
  },

  {
    id: 'cirurgia-toracica',
    patterns: [
      [
        /\b(cirurgia toracica|cirurgiao toracico|nodulo pulmonar para cirurgia|tumor de pulmao para cirurgia|pleura|derrame pleural recorrente)\b/,
        12,
        'cirurgia torácica',
      ],
    ],
  },

  {
    id: 'angiologia',
    patterns: [
      [
        /\b(angiologia|angiologista|microcirculacao|linfedema|doenca venosa|insuficiencia venosa)\b/,
        10,
        'vasos/circulação',
      ],
    ],
  },

  {
    id: 'endoscopia',
    patterns: [
      [
        /\b(endoscopia|endoscopia digestiva|colonoscopia|endoscopista)\b/,
        12,
        'procedimento endoscópico',
      ],
    ],
  },

  {
    id: 'anestesiologia',
    patterns: [
      [
        /\b(anestesia|anestesiologia|anestesista|avaliacao pre[- ]anestesica|pre[- ]anestesica|risco anestesico)\b/,
        12,
        'anestesia/avaliação pré-anestésica',
      ],
    ],
  },

  {
    id: 'medicina-trabalho',
    patterns: [
      [
        /\b(medicina do trabalho|medico do trabalho|exame admissional|exame demissional|aso|doenca ocupacional|acidente de trabalho)\b/,
        12,
        'saúde ocupacional',
      ],
    ],
  },

  {
    id: 'medicina-trafego',
    patterns: [
      [
        /\b(medicina do trafego|medico do trafego|exame para cnh|aptidao para dirigir|renovar cnh)\b/,
        12,
        'medicina do tráfego',
      ],
    ],
  },

  {
    id: 'medicina-legal-pericia',
    patterns: [
      [
        /\b(medicina legal|pericia medica|medico perito|laudo pericial|avaliacao pericial)\b/,
        12,
        'perícia médica',
      ],
    ],
  },

  {
    id: 'medicina-nuclear',
    patterns: [
      [
        /\b(medicina nuclear|cintilografia|pet scan|pet ct|iodoterapia)\b/,
        12,
        'medicina nuclear',
      ],
    ],
  },

  {
    id: 'radiologia',
    patterns: [
      [
        /\b(radiologia|radiologista|diagnostico por imagem|ressonancia magnetica|tomografia computadorizada|ultrassom|ultrassonografia|raio x)\b/,
        10,
        'diagnóstico por imagem',
      ],
    ],
  },

  {
    id: 'radioterapia',
    patterns: [
      [
        /\b(radioterapia|radioterapeuta|tratamento com radiacao|radiacao para cancer)\b/,
        13,
        'radioterapia',
      ],
    ],
  },

  {
    id: 'patologia-clinica',
    patterns: [
      [
        /\b(patologia clinica|medicina laboratorial|patologista clinico|exames laboratoriais|laboratorio clinico)\b/,
        14,
        'medicina laboratorial',
      ],
    ],
  },

  {
    id: 'patologia',
    patterns: [
      [
        /\b(patologia|patologista|biopsia para anatomopatologico|anatomopatologico|histopatologico)\b/,
        11,
        'patologia/anatomia patológica',
      ],
    ],
  },

  {
    id: 'acupuntura',
    patterns: [
      [
        /\b(acupuntura|acupunturista|tratamento com acupuntura)\b/,
        13,
        'acupuntura',
      ],
    ],
  },

  {
    id: 'cirurgia-pediatrica',
    patterns: [
      [
        /\b(cirurgia pediatrica|cirurgiao pediatrico|cirurgiao infantil|operacao pediatrica)\b/,
        13,
        'cirurgia pediátrica',
      ],
    ],
  },

  {
    id: 'homeopatia',
    patterns: [
      [
        /\b(homeopatia|homeopata|tratamento homeopatico)\b/,
        13,
        'homeopatia',
      ],
    ],
  },

  {
    id: 'medicina-emergencia',
    patterns: [
      [
        /\b(medicina de emergencia|medico emergencista|emergencista)\b/,
        13,
        'medicina de emergência',
      ],
    ],
  },

  {
    id: 'medicina-intensiva',
    patterns: [
      [
        /\b(medicina intensiva|medico intensivista|intensivista|terapia intensiva|uti)\b/,
        12,
        'medicina intensiva',
      ],
    ],
  },

  {
    id: 'medicina-preventiva-social',
    patterns: [
      [
        /\b(medicina preventiva|medicina preventiva e social|saude coletiva|prevencao em saude)\b/,
        12,
        'medicina preventiva e social',
      ],
    ],
  },

  {
    id: 'neurocirurgia',
    patterns: [
      [
        /\b(neurocirurgia|neurocirurgiao|cirurgia cerebral|cirurgia do cerebro|cirurgia da coluna neurologica|tumor cerebral para cirurgia|aneurisma cerebral para cirurgia)\b/,
        13,
        'neurocirurgia',
      ],
    ],
  },

  {
    id: 'pediatria',
    patterns: [
      [
        /\b(pediatria|pediatra|consulta pediatrica|consulta infantil|puericultura)\b/,
        13,
        'pediatria',
      ],
    ],
  },

  {
    id: 'psicologia',
    patterns: [
      [
        /\b(psicologia|psicologo|psicologa|terapia|psicoterapia|luto|estresse emocional|problema emocional|dificuldade emocional)\b/,
        11,
        'apoio psicológico',
      ],
      [
        /\b(ansiedade|insonia|irritabilidade|estresse)\b/,
        4,
        'sintoma emocional',
      ],
    ],
  },

  {
    id: 'clinica-medica',
    patterns: [
      [
        /\b(clinico geral|clinica medica)\b/,
        12,
        'avaliação clínica geral explícita',
      ],
      [
        /\b(checkup|check-up|mal estar|indisposicao|cansaco|fadiga|fraqueza geral|febre sem outros sintomas)\b/,
        8,
        'avaliação clínica geral',
      ],
    ],
  },
];

const genericSymptoms =
  /\b(dor|dores|doendo|febre|coceira|cocando|ardencia|vermelh\w*|inchaco|tontura|vertigem|nausea|enjoo|vomito|diarreia|toss\w*|coriza|espirros?|cansaco|fadiga|fraqueza|sangramento|caroco|nodulo|formigamento|dormencia|desconforto|mal estar|indisposicao|sintoma|sintomas|secrecao|catarro|palpitacao|desmaio|tremor|calafrio|perda de peso|ganho de peso|ferida|lesao|rigidez|espasmo|caibra|soluco)\b/;

const bodyTerms =
  /\b(cabeca|rosto|face|maxilar|mandibula|pescoco|nuca|olho|olhos|ouvido|ouvidos|nariz|garganta|boca|lingua|pele|cabelo|unha|peito|torax|coracao|pulmao|estomago|barriga|abdomen|intestino|reto|anus|figado|vesicula|pancreas|rim|rins|urina|urinar|urinario|urinaria|uretra|bexiga|mama|mamas|seio|seios|vagina|vulva|utero|ovario|prostata|testiculo|penis|joelho|ombro|braco|cotovelo|punho|mao|dedo|perna|quadril|panturrilha|pe|tornozelo|coluna|lombar|articulacao|musculo|osso|dente|dentes|gengiva)\b/;

const healthConcepts =
  /\b(diabetes|tireoide|alergia|asma|anemia|cancer|depressao|ansiedade|hipertensao|arritmia|refluxo|hernia|varizes|lupus|artrite|hiv|aids|tuberculose|gravidez|menstruacao|menopausa|obesidade|memoria|insonia|epilepsia|parkinson|glaucoma|catarata|psoriase|endometriose|fibromialgia|autismo|tdah|doenca|sindrome|transtorno|infeccao|inflamacao|problema de saude|diagnostico|exame alterado|resultado alterado)\b/;

const careVerbs =
  /\b(estou com|estou sentindo|sinto|tenho|apareceu|comecou|ficou|esta doendo|esta inchado|esta inchada|meu filho|minha filha|meu pai|minha mae|meu marido|minha esposa|onde devo levar|qual especialista|qual medico|que medico|quem devo procurar)\b/;

const locationNeededSymptoms =
  /\b(dor|dores|coceira|cocando|ardencia|inchaco|sangramento|caroco|nodulo|formigamento|dormencia|ferida|lesao|rigidez|espasmo|caibra)\b/;

const nonLocalizedGeneral =
  /\b(febre|cansaco|fadiga|mal estar|indisposicao|fraqueza geral|calafrio|perda de peso|ganho de peso)\b/;

const socialOnlyPattern =
  /^(?:oi|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem|como vai|teste|ok|certo|entendi|beleza)[!.? ]*$/;

function scoreRules(
  text: string,
  patient: PatientProfile,
) {
  const scored = new Map<
    string,
    {
      score: number;
      reasons: string[];
    }
  >();

  for (const rule of rules) {
    let score = 0;
    const reasons: string[] = [];

    for (const [
      pattern,
      weight,
      reason,
    ] of rule.patterns) {
      if (pattern.test(text)) {
        score += weight;
        reasons.push(reason);
      }
    }

    if (score > 0) {
      scored.set(rule.id, {
        score,
        reasons,
      });
    }
  }

  const isChild =
    patient.ageYears !== null &&
    patient.ageYears < 18;

  const childGeneral =
    /\b(febre|coriza|tosse|vomito|diarreia|mal estar|cansaco|sem apetite|falta de apetite|resfriado|gripe)\b/.test(
      text,
    );

  if (isChild && childGeneral) {
    const current =
      scored.get('pediatria') ?? {
        score: 0,
        reasons: [],
      };

    current.score += 14;

    current.reasons.push(
      'queixa geral em criança/adolescente',
    );

    scored.set(
      'pediatria',
      current,
    );
  }

  const explicitOlder =
    /\b(idos[oa]|terceira idade|mais de 70 anos|mais de 80 anos)\b/.test(
      text,
    );

  if (
    (patient.ageYears !== null &&
      patient.ageYears >= 75) ||
    explicitOlder
  ) {
    const current =
      scored.get('geriatria') ?? {
        score: 0,
        reasons: [],
      };

    if (
      /\b(memoria|quedas?|fragilidade|varios remedios|polifarmacia|confusao recorrente)\b/.test(
        text,
      )
    ) {
      current.score += 9;

      current.reasons.push(
        'questão geriátrica',
      );

      scored.set(
        'geriatria',
        current,
      );
    }
  }

  return [...scored.entries()]
    .map(([id, value]) => ({
      id,
      score: value.score,
      reason: value.reasons.join(', '),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.id.localeCompare(b.id),
    );
}

export function broadFallbackId(
  patient: PatientProfile,
) {
  if (
    patient.ageYears !== null &&
    patient.ageYears < 18
  ) {
    return 'pediatria';
  }

  return 'clinica-medica';
}

export function routeComplaint(
  messages: string[],
  patient: PatientProfile,
): ComplaintRouting {
  const text = normalize(
    messages.join('\n'),
  ).trim();

  const socialOnly =
    socialOnlyPattern.test(
      normalize(
        messages.at(-1) ?? '',
      ).trim(),
    );

  const lexicalHealth =
    genericSymptoms.test(text) ||
    bodyTerms.test(text) ||
    healthConcepts.test(text) ||
    careVerbs.test(text);

  const candidates =
    scoreRules(text, patient);

  const fallbackId =
    broadFallbackId(patient);

  const healthComplaint =
    !socialOnly &&
    (lexicalHealth ||
      candidates.length > 0);

  if (socialOnly) {
    return {
      candidates: [],
      deterministicId: null,
      fallbackId,
      needsClarification: true,
      clarificationTopics: ['location'],
      confidence: 'fallback',
      healthComplaint: false,
      socialOnly: true,
    };
  }

  /*
   * If a relationship suggests a child but the patient's age is
   * genuinely unknown, ask only age when the complaint is general/weak.
   *
   * A strong organ-specific route (eye, ear, etc.) can still be used
   * without assuming that "filho/filha" means a minor.
   */
  if (
    patient.needsAge &&
    (
      candidates.length === 0 ||
      (candidates[0]?.score ?? 0) < 10
    )
  ) {
    return {
      candidates: candidates.slice(
        0,
        5,
      ),
      deterministicId: null,
      fallbackId,
      needsClarification: true,
      clarificationTopics: [
        'age_group',
      ],
      confidence: 'medium',
      healthComplaint: true,
      socialOnly: false,
    };
  }

  /*
   * Generic localizable symptoms need the body location before we
   * choose a specialty.
   *
   * This is the only common first-round clarification; we do not
   * require duration/pattern as a form.
   */
  if (
    healthComplaint &&
    locationNeededSymptoms.test(
      text,
    ) &&
    !bodyTerms.test(text) &&
    (candidates[0]?.score ?? 0) <
      9
  ) {
    const topics: ClarificationTopic[] =
      [];

    if (patient.needsAge) {
      topics.push('age_group');
    }

    topics.push('location');

    return {
      candidates:
        candidates.slice(0, 5),
      deterministicId: null,
      fallbackId,
      needsClarification: true,
      clarificationTopics:
        topics.slice(0, 2),
      confidence: 'fallback',
      healthComplaint: true,
      socialOnly: false,
    };
  }

  if (candidates.length) {
    const [first, second] =
      candidates;

    const margin =
      first.score -
      (second?.score ?? 0);

    const broadOnly =
      candidates.length === 1 &&
      first.id === fallbackId &&
      first.score >= 4;

    const high =
      first.score >= 10 &&
      margin >= 3;

    return {
      candidates:
        candidates.slice(0, 5),

      deterministicId:
        high || broadOnly
          ? first.id
          : null,

      fallbackId,

      needsClarification: false,

      clarificationTopics: [],

      confidence:
        high
          ? 'high'
          : broadOnly
            ? 'fallback'
            : 'medium',

      healthComplaint: true,

      socialOnly: false,
    };
  }

  /*
   * General systemic symptoms have a broad, sensible entry point.
   * Asking "where?" for fever or fatigue would be pointless and slower.
   */
  if (
    healthComplaint &&
    nonLocalizedGeneral.test(text)
  ) {
    return {
      candidates: [
        {
          id: fallbackId,
          score: 4,
          reason:
            'porta de entrada ampla',
        },
      ],

      deterministicId: fallbackId,

      fallbackId,

      needsClarification: false,

      clarificationTopics: [],

      confidence: 'fallback',

      healthComplaint: true,

      socialOnly: false,
    };
  }

  /*
   * A recognizable health request with no lexical specialty match
   * gets one semantic attempt against the active taxonomy.
   *
   * ChatService still guarantees Clínica Médica/Pediatria if the
   * model is unavailable or cannot resolve a valid specialty.
   */
  if (healthComplaint) {
    return {
      candidates: [],

      deterministicId: null,

      fallbackId,

      needsClarification: false,

      clarificationTopics: [],

      confidence: 'fallback',

      healthComplaint: true,

      socialOnly: false,
    };
  }

  /*
   * Text without a health signal is not forced through the model.
   * This avoids mapping unrelated conversation to a medical specialty
   * and is faster than an unnecessary semantic call.
   */
  return {
    candidates: [],

    deterministicId: null,

    fallbackId,

    needsClarification: true,

    clarificationTopics: [
      'location',
    ],

    confidence: 'fallback',

    healthComplaint: false,

    socialOnly: false,
  };
}