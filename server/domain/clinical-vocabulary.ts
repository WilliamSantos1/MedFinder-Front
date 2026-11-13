import { normalize } from './text.js';

/**
 * Layperson-friendly recognition vocabulary, NOT a symptom→diagnosis system.
 * Each entry groups anatomical terms and ways of describing a complaint into
 * possible FIRST-REFERRAL specialties. Overlaps remain ambiguous for the LLM.
 * Clinical safety rules and the patient interview run separately.
 *
 * Keep input terms accent-independent: normalize() removes accents.
 * Prefer full phrases for short/ambiguous names (e.g. "pe" = foot).
 */
export type VocabularyDomain =
  | 'musculoskeletal' | 'ent' | 'digestive' | 'neurologic' | 'skin'
  | 'eye' | 'urinary' | 'gynecologic' | 'respiratory' | 'cardiovascular'
  | 'endocrine' | 'blood' | 'vascular' | 'breast' | 'mental' | 'geriatric';

interface VocabularyGroup {
  domain: VocabularyDomain;
  specialtyId: string;
  terms: readonly string[];
  /** Conditions and symptoms warrant more weight than anatomy alone. */
  weight: number;
  kind: 'anatomy' | 'symptom';
}

const groups: readonly VocabularyGroup[] = [
  {
    domain: 'musculoskeletal', specialtyId: 'ortopedia', kind: 'anatomy', weight: 7,
    terms: [
      'triceps','tricipe','triceps braquial','biceps','bicipe','biceps braquial',
      'deltoide','deltoides','antebraco','antebracos','braco superior','parte de tras do braco',
      'parte posterior do braco','parte de frente do braco','parte de cima do braco',
      'musculo do braco','musculos do braco','braquiorradial','braquial','supinador',
      'tendao do biceps','tendao do triceps','manguito rotador','escapula','escapulas',
      'omoplata','omoplatas','clavicula','claviculas','acromio','esterno clavicular',
      'rotula','patela','menisco','meniscos','ligamento cruzado','ligamento colateral',
      'femur','tibia','fibula','peronio','canela','canelas','quadriceps','quadricipite',
      'isquiotibiais','posterior da coxa','parte de tras da coxa','coxa','coxas',
      'adutor','adutores','abdutor','abdutores','virilha muscular',
      'panturrilha','panturrilhas','gastrocnemio','soleo','tendao de aquiles',
      'calcanhar','calcanhares','planta do pe','sola do pe','sola dos pes',
      'arco do pe','dorso do pe','peito do pe','metatarso','metatarsos',
      'dedao do pe','dedos do pe','falanges','calcaneo','calcanio',
      'gluteo','gluteos','nadega','nadegas','bumbum','musculo piriforme',
      'sacro','sacral','coccix','coxis','iliossacra','sacroiliaca',
      'punho direito','punho esquerdo','metacarpo','polegar','indicador',
      'dedo medio','anelar','dedo minimo','tendao','tendoes','ligamento',
      'cartilagem','articulacao do ombro','articulacao do quadril',
      'vertebra','vertebras','disco intervertebral','cervical','toracica','dorsal',
      'lombossacra','lombo sacra','musculos paravertebrais','trapezio',
      'grande dorsal','peitoral maior','costela','costelas','intercostal',
      'tuberosidade','olecrano','ulna','radio do braco','epicondilo',
    ],
  },
  {
    domain: 'musculoskeletal', specialtyId: 'ortopedia', kind: 'symptom', weight: 11,
    terms: [
      'dor muscular','distensao muscular','estiramento muscular','estiramento',
      'contratura muscular','contratura','dor apos treino','dor apos corrida',
      'dor depois de malhar','dor depois da academia','dor na musculatura',
      'fisgada muscular','puxao muscular','lesao no tendao','tendinopatia',
      'dor ossea','dor no osso','pancada no osso','estalo na articulacao',
      'articulacao travada','articulacao inchada','dificuldade de apoiar o pe',
      'dor na virilha apos correr','dor no quadril apos correr',
      'dor no triceps','dor no biceps','dor no antebraco','dor no gluteo',
      'torcicolo','lombalgia','cervicalgia','dorsalgia','dor no calcanhar',
    ],
  },
  {
    domain: 'ent', specialtyId: 'otorrinolaringologia', kind: 'anatomy', weight: 8,
    terms: [
      'amigdala','amigdalas','tonsila','tonsilas','tonsilas palatinas',
      'faringe','laringe','epiglote','uvula','campainha da garganta',
      'corda vocal','cordas vocais','prega vocal','pregas vocais',
      'ouvido interno','ouvido medio','ouvido externo','canal auditivo',
      'trompa de eustaquio','tuba auditiva','orelha','orelhas','pavilhao auricular',
      'narina','narinas','septo nasal','corneto nasal','cornetos nasais',
      'seios da face','seios paranasais','sinus da face','nasofaringe',
      'adenoides','amigdalite','dor ao engolir','engolir doi','garganta arranhando',
      'dor de garganta','voz falhando','nariz escorrendo','nariz trancado',
    ],
  },
  {
    domain: 'digestive', specialtyId: 'gastroenterologia', kind: 'anatomy', weight: 7,
    terms: [
      'esofago','duodeno','jejuno','ileo','intestino delgado','intestino grosso',
      'colon','sigmoide','ceco','regiao epigastrica','epigastrio',
      'umbigo','regiao umbilical','flanco direito','flanco esquerdo',
      'hipocondrio direito','hipocondrio esquerdo','fossa iliaca direita',
      'fossa iliaca esquerda','vesicula biliar','vias biliares',
      'bile','figado','pancreas','estomago','reto intestinal',
    ],
  },
  {
    domain: 'digestive', specialtyId: 'gastroenterologia', kind: 'symptom', weight: 12,
    terms: [
      'disenteria','desinteria','disinteria','dissenteria',
      'diarreia aquosa','diarreia com sangue','fezes liquidas',
      'fezes moles','evacuacoes liquidas','evacuacoes frequentes',
      'evacuando muito','intestino solto','intestino preso','constipado',
      'prisao de ventre','diarreia persistente','gastroenterite',
      'fezes com muco','muco nas fezes','sangue nas fezes',
      'dor para evacuar','urgencia para evacuar','tenesmo',
      'dor de barriga','dor no estomago','colica intestinal','colica abdominal',
      'estufamento abdominal','distensao abdominal','barriga estufada',
      'barriga inchada','gases intestinais','flatulencia','arrotos frequentes',
      'queimacao no estomago','queimacao abdominal','ma digestao',
      'dificuldade para engolir','dificuldade de engolir','disfagia',
      'regurgitacao','vomitando','nauseas','enjoo constante','vomitos frequentes',
      'fezes escuras','fezes pretas','esteatorreia',
    ],
  },
  {
    domain: 'digestive', specialtyId: 'gastroenterologia', kind: 'symptom', weight: 7,
    terms: ['diarreia','intestino solto','evacuacoes frequentes','fezes moles'],
  },
  {
    domain: 'neurologic', specialtyId: 'neurologia', kind: 'anatomy', weight: 7,
    terms: [
      'cerebro','cerebelo','tronco cerebral','nervos perifericos',
      'nervo ciatico','ciatico','nervo mediano','nervo ulnar','nervo radial',
      'nervo facial','nervo trigemeo','medula espinhal','plexo braquial',
      'nervo comprimido','nervo pinçado','nervo pincado',
    ],
  },
  {
    domain: 'neurologic', specialtyId: 'neurologia', kind: 'symptom', weight: 10,
    terms: [
      'perda de sensibilidade','formigando','dormindo os dedos','parestesia',
      'perda de equilibrio','desequilibrio','tremedeira','tremedeiras',
      'movimentos involuntarios','espasmos involuntarios','tiques',
      'perda de memoria','esquecimentos frequentes','crises convulsivas',
      'dor neuropatica','dor em choque','choque nos nervos',
      'dificuldade para coordenar movimentos','visao dupla',
    ],
  },
  {
    domain: 'skin', specialtyId: 'dermatologia', kind: 'anatomy', weight: 8,
    terms: [
      'couro cabeludo','foliculo piloso','foliculos','cuticula','cuticulas',
      'unha do pe','unha da mao','cutis','epiderme','derme',
      'virilha com micose','lesao cutanea','cabelo quebradico',
    ],
  },
  {
    domain: 'skin', specialtyId: 'dermatologia', kind: 'symptom', weight: 11,
    terms: [
      'coceira na pele','pele descascando','descascamento da pele',
      'erupcao cutanea','bolinhas na pele','carocos na pele','irritacao na pele',
      'urticaria','verruga','mancha escura na pele','ferida que nao cicatriza',
      'coceira no couro cabeludo','bolhas na pele','descamacao na pele',
    ],
  },
  {
    domain: 'eye', specialtyId: 'oftalmologia', kind: 'anatomy', weight: 9,
    terms: [
      'conjuntiva','pupila','iris do olho','nervo optico','cristalino',
      'macula','retina','cornea','palpebra','palpebras','sobrancelha',
      'canal lacrimal','saco lacrimal','olho esquerdo','olho direito',
    ],
  },
  {
    domain: 'eye', specialtyId: 'oftalmologia', kind: 'symptom', weight: 11,
    terms: [
      'visao borrada','visao embacada','visao turva','coceira nos olhos',
      'ardor nos olhos','ardencia nos olhos','olho lacrimejando','olhos lacrimejando',
      'olho vermelho','olhos vermelhos','dor atras do olho','sensibilidade a luz',
      'dificuldade para enxergar','pontos na visao',
    ],
  },
  {
    domain: 'urinary', specialtyId: 'urologia', kind: 'anatomy', weight: 8,
    terms: [
      'ureter','ureteres','uretra','meato urinario','bexiga urinaria',
      'canal urinario','escroto','bolsa escrotal',
      'glande','prepucio','epididimo','canal deferente',
    ],
  },
  {
    domain: 'urinary', specialtyId: 'urologia', kind: 'symptom', weight: 11,
    terms: [
      'ardor para urinar','queimacao ao urinar','urina ardendo','xixi ardendo',
      'xixi com sangue','sangue no xixi','vontade de fazer xixi toda hora',
      'urinando toda hora','dificuldade de fazer xixi','dor na bexiga',
      'incontinencia urinaria','urina escura','urina espumosa',
    ],
  },
  {
    domain: 'gynecologic', specialtyId: 'ginecologia', kind: 'anatomy', weight: 8,
    terms: [
      'colo do utero','endometrio','trompa de falopio','trompas de falopio',
      'tuba uterina','tubas uterinas','labios vaginais','labios genitais',
      'clitoris','perineo feminino','ovarios','vulva','vagina','uterino',
    ],
  },
  {
    domain: 'gynecologic', specialtyId: 'ginecologia', kind: 'symptom', weight: 11,
    terms: [
      'corrimento vaginal','corrimento com cheiro','odor vaginal','coceira vaginal',
      'ardencia vaginal','sangramento entre menstruacoes','sangramento fora do periodo',
      'colica menstrual','dor no baixo ventre durante menstruacao',
      'dor durante a relacao','dor na relacao sexual','sangramento apos relacao',
      'atraso da menstruacao','menstruacao irregular',
    ],
  },
  {
    domain: 'respiratory', specialtyId: 'pneumologia', kind: 'anatomy', weight: 8,
    terms: [
      'bronquios','bronquiolos','alveolos pulmonares','traqueia','pleura',
      'pulmao direito','pulmao esquerdo','sistema respiratorio',
      'diafragma respiratorio',
    ],
  },
  {
    domain: 'respiratory', specialtyId: 'pneumologia', kind: 'symptom', weight: 10,
    terms: [
      'chiado no peito','chiado para respirar','tosse persistente',
      'tosse com catarro','tosse seca','falta de folego','cansaco para respirar',
      'respiracao ofegante','ronco intenso','roncando muito',
    ],
  },
  {
    domain: 'cardiovascular', specialtyId: 'cardiologia', kind: 'anatomy', weight: 8,
    terms: [
      'miocardio','pericardio','valvula mitral','valvula aortica',
      'atrio','ventriculo','coronaria','coronarias','aorta',
    ],
  },
  {
    domain: 'cardiovascular', specialtyId: 'cardiologia', kind: 'symptom', weight: 10,
    terms: [
      'coracao disparado','coracao acelerado','batimento irregular',
      'batimentos irregulares','coracao palpitando','palpitacoes frequentes',
    ],
  },
  {
    domain: 'endocrine', specialtyId: 'endocrinologia', kind: 'anatomy', weight: 8,
    terms: [
      'hipofise','hipotalamo','glandula tireoide','paratireoide',
      'glandula adrenal','suprarrenal','pancreas endocrino',
    ],
  },
  {
    domain: 'endocrine', specialtyId: 'endocrinologia', kind: 'symptom', weight: 9,
    terms: [
      'sede excessiva','urinando demais com sede','glicemia alta',
      'glicemia baixa','hormonios alterados','tireoide alterada',
    ],
  },
  {
    domain: 'vascular', specialtyId: 'cirurgia-vascular', kind: 'anatomy', weight: 7,
    terms: [
      'veia safena','veias das pernas','arterias das pernas','vasos sanguineos',
      'veias varicosas','arteria femoral',
    ],
  },
  {
    domain: 'vascular', specialtyId: 'cirurgia-vascular', kind: 'symptom', weight: 10,
    terms: [
      'perna muito inchada','inchaço unilateral','inchaco unilateral',
      'dor na panturrilha com inchaco','varizes doloridas','pernas pesadas',
    ],
  },
  {
    domain: 'blood', specialtyId: 'hematologia', kind: 'symptom', weight: 9,
    terms: [
      'hematomas sem motivo','roxos sem bater','sangramentos frequentes',
      'plaquetas baixas','hemoglobina baixa','anemia confirmada',
    ],
  },
  {
    domain: 'breast', specialtyId: 'mastologia', kind: 'anatomy', weight: 9,
    terms: [
      'areola','bico do peito','mamilo','mamilos','glandula mamaria',
      'nodulo mamario','secrecao pelo mamilo',
    ],
  },
  {
    domain: 'mental', specialtyId: 'psiquiatria', kind: 'symptom', weight: 8,
    terms: [
      'crises de panico','crise de ansiedade','ansiedade intensa',
      'tristeza persistente','insonia cronica','alteracoes de humor',
    ],
  },
  {
    domain: 'geriatric', specialtyId: 'geriatria', kind: 'symptom', weight: 10,
    terms: [
      'avaliacao geriatrica','declinio funcional','perda de autonomia',
      'quedas recorrentes','quedas repetidas','fragilidade do idoso',
      'fragilidade da idosa','multiplas doencas cronicas',
      'muitos medicamentos','varios remedios todos os dias',
      'polifarmacia','revisao de medicamentos do idoso',
      'dependencia para atividades diarias','dificuldade nas atividades diarias',
    ],
  },
];

function exactPhrasePattern(terms: readonly string[]): RegExp {
  const escaped = terms
    .map((term) => normalize(term))
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${[...new Set(escaped)].join('|')})\\b`);
}
const compiled = groups.map((group) => ({ ...group, pattern: exactPhrasePattern(group.terms) }));

export interface VocabularyMatch {
  domain: VocabularyDomain;
  specialtyId: string;
  weight: number;
  kind: 'anatomy' | 'symptom';
  term: string;
}

export function vocabularyMatches(message: string): VocabularyMatch[] {
  const text = normalize(message);
  return compiled.flatMap((item) => {
    const found = item.pattern.exec(text);
    return found ? [{ domain: item.domain, specialtyId: item.specialtyId, weight: item.weight,
      kind: item.kind, term: found[0] }] : [];
  });
}

export function hasVocabularyLocation(message: string): boolean {
  return vocabularyMatches(message).some((match) => match.kind === 'anatomy' ||
    ['digestive', 'ent', 'eye', 'urinary', 'gynecologic', 'breast'].includes(match.domain));
}

export function hasVocabularyHealthTerm(message: string): boolean {
  return vocabularyMatches(message).length > 0;
}

export function hasMusculoskeletalLocation(message: string): boolean {
  return vocabularyMatches(message).some((match) => match.domain === 'musculoskeletal');
}

export function vocabularyDomains(message: string): VocabularyDomain[] {
  return [...new Set(vocabularyMatches(message).map((match) => match.domain))];
}
