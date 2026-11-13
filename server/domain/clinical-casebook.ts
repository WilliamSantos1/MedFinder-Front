import type { PatientProfile } from './patient.js';
import { positiveEvidenceText } from './negated-evidence.js';
import { normalize } from './text.js';

/**
 * Curated first-contact navigation SCENARIOS, not diagnoses.
 * The goal is to consider mechanisms, associated findings, duration and age
 * together rather than mapping an anatomical word to an arbitrary specialist.
 *
 * Editorial policy:
 * - score values are relative routing hints, NOT probabilities or risk scores;
 * - a scenario must never state that a disease is present;
 * - urgent evaluation always outranks elective clinic recommendations;
 * - referenced public guidance informs the rules, but these local specialty
 *   rankings are NOT official recommendations from those publishers;
 * - each rule needs testing and eventual clinician review before production.
 */
export interface CasebookSignal {
  id: string;
  category: string;
  reason: string;
  sourceId: string;
  referrals: readonly { id: string; score: number }[];
  /** When an *explicit combined pattern* makes a weak lexical route misleading. */
  exclude?: readonly string[];
}

type Demographic = 'child' | 'adult' | 'older';
type CaseDefinition = CasebookSignal & {
  all: readonly RegExp[];
  none?: readonly RegExp[];
  demographic?: Demographic;
};

/** All terms must occur in positive evidence. Regex input is accent-normalized. */
const D: readonly CaseDefinition[] = [
  // MUSCULOSKELETAL / TRAUMATIC: mechanism and impairment override the word "unha".
  { id: 'finger-crush', category: 'trauma', sourceId: 'fingertip',
    reason: 'Esmagamento/prensamento do dedo com sintomas locais: avaliação traumato-ortopédica e, conforme lesão, da mão',
    all: [/\b(?:prensad\w*|imprensad\w*|prensou|imprensou|prensament\w*|imprensament\w*|esmag\w*|prendeu|prendi|entalad\w*|porta fechou|bateu forte)\b/, /\b(?:dedos?|indicador|polegar|unhas?|pontas? dos? dedos?|falange|mao)\b/],
    referrals: [{ id: 'ortopedia', score: 38 }, { id: 'cirurgia-mao', score: 36 }], exclude: ['dermatologia'] },
  { id: 'nail-impact', category: 'trauma', sourceId: 'fingertip',
    reason: 'Dor da unha após impacto ou acidente é inicialmente uma queixa traumática, não cosmética/dermatológica',
    all: [/\b(?:unhas?|cuticula|leito ungueal)\b/, /\b(?:batida|bateu|bati|bater|pancada|trauma|machucad\w*|prensad\w*|imprensou|prensou|esmag\w*|queda|corte)\b/],
    referrals: [{ id: 'ortopedia', score: 35 }, { id: 'cirurgia-mao', score: 32 }], exclude: ['dermatologia'] },
  { id: 'finger-motion-after-trauma', category: 'trauma', sourceId: 'fingertip',
    reason: 'Restrição de movimento do dedo depois de lesão precisa de avaliação funcional presencial',
    all: [/\b(?:dedos?|indicador|polegar|mao|unha|falange)\b/, /\b(?:machucad\w*|pancada|prensad\w*|imprensad\w*|prensou|imprensou|esmag\w*|trauma|batida|bateu)\b/, /\b(?:dificuldade (?:de|para) (?:mexer|movimentar|dobrar|esticar)|nao consegue (?:dobrar|mexer|esticar)|movimentar|inchar|inchaco|inchad\w*)\b/],
    referrals: [{ id: 'ortopedia', score: 40 }, { id: 'cirurgia-mao', score: 38 }], exclude: ['dermatologia'] },
  { id: 'chronic-nail-change', category: 'skin', sourceId: 'primary-referral',
    reason: 'Alteração ungueal não traumática com mudança de cor ou espessura',
    all: [/\b(?:unhas?|cuticula)\b/, /\b(?:amarel\w*|esfarel\w*|engross\w*|manchas?|micose|descam\w*|deformad\w*|inflamacao cronica)\b/],
    none: [/\b(?:prensad\w*|imprensad\w*|esmag\w*|pancada|batida|acidente)\b/],
    referrals: [{ id: 'dermatologia', score: 28 }] },
  { id: 'finger-trigger', category: 'hand', sourceId: 'orthopedics', reason: 'Travamento persistente de dedo ou dor ao flexionar',
    all: [/\b(?:dedos?|polegar|indicador)\b/, /\b(?:trav\w*|estalo|gatilho|nao estica|bloqueio)\b/],
    referrals: [{ id: 'cirurgia-mao', score: 27 }, { id: 'ortopedia', score: 24 }] },
  { id: 'hand-tingling', category: 'hand', sourceId: 'orthopedics', reason: 'Formigamento recorrente na mão/punho precisa de avaliação dos nervos e estruturas locais',
    all: [/\b(?:mao|maos|punho|dedos?)\b/, /\b(?:formig\w*|dormenc\w*|choque|adormec\w*)\b/],
    referrals: [{ id: 'cirurgia-mao', score: 24 }, { id: 'neurologia', score: 22 }, { id: 'ortopedia', score: 22 }] },
  { id: 'toe-crush', category: 'trauma', sourceId: 'orthopedics', reason: 'Esmagamento ou impacto nos dedos do pé',
    all: [/\b(?:dedos? do pe|dedao do pe|unha do pe|pe)\b/, /\b(?:esmag\w*|prens\w*|imprens\w*|batida|bati|pancada|trauma)\b/],
    referrals: [{ id: 'ortopedia', score: 32 }], exclude: ['dermatologia'] },
  { id: 'ankle-sprain', category: 'trauma', sourceId: 'orthopedics', reason: 'Torção de tornozelo ou pé com dor e inchaço',
    all: [/\b(?:tornozelo|pe|pes)\b/, /\b(?:torc\w*|entorse|virou|pisei em falso|pisou em falso)\b/],
    referrals: [{ id: 'ortopedia', score: 30 }] },
  { id: 'post-run-muscle', category: 'musculoskeletal', sourceId: 'orthopedics', reason: 'Dor localizada após esforço físico',
    all: [/\b(?:corrida|correr|academia|treino|exercicio|esforco|carregar peso|musculacao)\b/, /\b(?:dor|dores|dolorid\w*|fisgad\w*|espasm\w*|distensao)\b/, /\b(?:braco|biceps|triceps|perna|panturrilha|quadril|virilha|joelho|ombro|coxa|gluteo|pe|costas|lombar|musculo|tendao)\b/],
    referrals: [{ id: 'ortopedia', score: 27 }] },
  { id: 'shoulder-clavicle-load', category: 'musculoskeletal', sourceId: 'orthopedics',
    reason: 'Dor em clavícula ou ombro após esforço de levantar ou carregar objeto: verificar sinais associados, depois considerar Ortopedia',
    all: [/\b(?:clavicula|ombro|ombros)\b/, /\b(?:levant\w*|ergu\w*|carreg\w*|peso|esforco|academia)\b/, /\b(?:dor|dores|doendo|fisgada|pontada)\b/],
    referrals: [{ id: 'ortopedia', score: 29 }, { id: 'clinica-medica', score: 20 }] },
  { id: 'joint-trauma', category: 'musculoskeletal', sourceId: 'orthopedics', reason: 'Trauma articular ou dor pós-impacto',
    all: [/\b(?:joelho|quadril|ombro|cotovelo|punho|tornozelo|articulacao|patela)\b/, /\b(?:pancada|queda|bati|batida|machuquei|lesao|torcao|entorse)\b/],
    referrals: [{ id: 'ortopedia', score: 29 }] },
  { id: 'joint-instability', category: 'musculoskeletal', sourceId: 'orthopedics', reason: 'Articulação com travamento/instabilidade e limitação de função',
    all: [/\b(?:joelho|ombro|quadril|tornozelo|cotovelo|articulacao)\b/, /\b(?:trav\w*|falseand\w*|instabilidade|nao consegue apoiar|nao consegue andar|estalo com inchaco)\b/],
    referrals: [{ id: 'ortopedia', score: 27 }] },
  { id: 'back-mechanical', category: 'musculoskeletal', sourceId: 'orthopedics', reason: 'Dor lombar após esforço/movimento',
    all: [/\b(?:lombar|lombalgia|costas|coluna)\b/, /\b(?:esforco|peso|academia|corrida|movimentar|agachar|levantar|treino)\b/],
    referrals: [{ id: 'ortopedia', score: 25 }, { id: 'clinica-medica', score: 22 }] },
  { id: 'back-radiating', category: 'neuromusculoskeletal', sourceId: 'neurology', reason: 'Dor na coluna irradiando para membros exige avaliação de coluna e sintomas neurológicos associados',
    all: [/\b(?:lombar|coluna|costas)\b/, /\b(?:irradi\w*|desce para a perna|formig\w*|dormenc\w*|ciatico)\b/],
    referrals: [{ id: 'ortopedia', score: 27 }, { id: 'neurologia', score: 24 }] },
  { id: 'diffuse-joint', category: 'rheumatologic', sourceId: 'primary-referral', reason: 'Rigidez matinal ou vários locais com queixa articular persistente',
    all: [/\b(?:varias articulacoes|multiplas articulacoes|maos e pes|joelhos e punhos|articulacoes|articulacao)\b/, /\b(?:rigidez matinal|rigidez|rigid\w*|inchaco recorrente|dor recorrente|dor cronica|inflamacao)\b/],
    referrals: [{ id: 'reumatologia', score: 28 }, { id: 'clinica-medica', score: 24 }] },
  { id: 'hot-swollen-joint', category: 'inflammatory-joint', sourceId: 'septic-joint', reason: 'Articulação agudamente dolorosa, inchada e avermelhada: avaliar presencialmente antes de escolher consulta eletiva',
    all: [/\b(?:articulacao|joelho|tornozelo|cotovelo|punho|ombro|quadril)\b/, /\b(?:inchad\w*|inchaco|edema)\b/, /\b(?:vermelh\w*|quente|calor local|febre)\b/],
    referrals: [{ id: 'ortopedia', score: 31 }, { id: 'clinica-medica', score: 29 }] },
  { id: 'achilles-heel', category: 'musculoskeletal', sourceId: 'orthopedics', reason: 'Dor no tendão/calcanhar associada a movimento ou esforço',
    all: [/\b(?:aquiles|calcanhar|tendao)\b/, /\b(?:dor|fisgada|treino|corrida|exercicio|incha\w*)\b/],
    referrals: [{ id: 'ortopedia', score: 25 }] },

  // RESPIRATORY / ENT / EYE: avoid making one organ dominate a systemic picture.
  { id: 'acute-respiratory-systemic', category: 'respiratory', sourceId: 'cdc-respiratory', reason: 'Febre ou indisposição junto com sintomas nasais/respiratórios: avaliação inicial do conjunto',
    all: [/\b(?:coriza|nariz (?:entupido|congestionado|escorrendo)|congestao nasal|tosse|dor de garganta|espirr\w*)\b/, /\b(?:febre|calafri\w*|indisposicao|mal estar|cansaco)\b/],
    none: [/\b(?:perda de visao|visao (?:embacada|turva)|fotofobia|dor (?:muito )?(?:forte|intensa) (?:no|nos) olhos?|dor ocular intensa)\b/],
    referrals: [{ id: 'clinica-medica', score: 33 }, { id: 'otorrinolaringologia', score: 30 }], exclude: ['oftalmologia'] },
  { id: 'nasal-persistent', category: 'ent', sourceId: 'primary-referral', reason: 'Obstrução/coriza nasal recorrente sem sinais sistêmicos predominantes',
    all: [/\b(?:nariz entupido|congestao nasal|coriza|obstrucao nasal)\b/, /\b(?:recorrent\w*|persistente|semanas|meses|sempre|repetid\w*)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 27 }, { id: 'alergologia-imunologia', score: 23 }] },
  { id: 'allergic-nose', category: 'ent', sourceId: 'primary-referral', reason: 'Queixa nasal recorrente com coceira e espirros',
    all: [/\b(?:nariz|coriza|rinite)\b/, /\b(?:coceira|espirros|espirrando|alergia|poeira)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 24 }, { id: 'alergologia-imunologia', score: 24 }] },
  { id: 'ear-pain-discharge', category: 'ent', sourceId: 'primary-referral', reason: 'Dor no ouvido com secreção ou perda auditiva',
    all: [/\b(?:ouvido|orelha|ouvidos)\b/, /\b(?:secrecao|pus|dor|drenagem|audicao|escutar)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 29 }] },
  { id: 'sudden-hearing', category: 'ent', sourceId: 'nice-hearing', reason: 'Redução súbita da audição necessita avaliação imediata, sem aguardar consulta eletiva',
    all: [/\b(?:perda de audicao|perdi a audicao|perda auditiva|surdez|parei de ouvir|nao estou ouvindo|nao consigo ouvir|audicao diminuiu)\b/, /\b(?:repente|subita|subitamente|hoje|ontem|de repente)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 34 }] },
  { id: 'voice-chronic', category: 'ent', sourceId: 'primary-referral', reason: 'Rouquidão ou alteração de voz persistente',
    all: [/\b(?:rouquidao|rouc\w*|voz rouca|voz falhando|perda da voz|disfonia)\b/, /\b(?:semanas|meses|persistente|recorrente|nao melhora)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 30 }] },
  { id: 'throat-local', category: 'ent', sourceId: 'primary-referral', reason: 'Sintoma predominante em garganta/amígdalas',
    all: [/\b(?:garganta|amigdala\w*|faringe)\b/, /\b(?:dor|ardencia|inflama\w*|engolir|inchada\w*)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 24 }, { id: 'clinica-medica', score: 21 }] },
  { id: 'ocular-local', category: 'eye', sourceId: 'aafp-eye', reason: 'Sintomas oculares predominantes sem síndrome respiratória sistêmica',
    all: [/\b(?:olhos?|ocular|visao|palpebras?)\b/, /\b(?:ardencia|ardor|vermelh\w*|coceira|lacrimej\w*|dor|secrecao)\b/],
    none: [/\b(?:coriza|nariz congestionado|congestao nasal|febre e tosse)\b/],
    referrals: [{ id: 'oftalmologia', score: 27 }] },
  { id: 'eyelid-swelling', category: 'eye', sourceId: 'nhs-eyelid', reason: 'Pálpebra inchada e avermelhada deve ser avaliada no contexto ocular, com atenção à dor, febre e alterações visuais',
    all: [/\b(?:palpebra\w*|ao redor dos olhos|em volta dos olhos)\b/, /\b(?:inchad\w*|inchaco|edema)\b/],
    referrals: [{ id: 'oftalmologia', score: 30 }, { id: 'clinica-medica', score: 23 }] },
  { id: 'ocular-visual', category: 'eye', sourceId: 'aafp-eye', reason: 'Alteração visual com dor ou fotofobia merece avaliação ocular prioritária',
    all: [/\b(?:olhos?|ocular|visao|vista)\b/, /\b(?:visao turva|visao embacada|perda de visao|fotofobia|dor intensa|dor forte)\b/],
    referrals: [{ id: 'oftalmologia', score: 36 }] },
  { id: 'wheeze-recurrent', category: 'respiratory', sourceId: 'primary-referral', reason: 'Chiado ou dificuldade respiratória recorrente fora de quadro de emergência',
    all: [/\b(?:chiado|chiando|asma|falta de ar aos esforcos)\b/, /\b(?:frequente|recorrente|semanas|meses|esforcos|piora a noite)\b/],
    referrals: [{ id: 'pneumologia', score: 29 }, { id: 'clinica-medica', score: 24 }] },
  { id: 'persistent-cough', category: 'respiratory', sourceId: 'primary-referral', reason: 'Tosse persistente merece avaliação clínica; Pneumologia pode ser pertinente',
    all: [/\b(?:tosse|tossindo|tossir)\b/, /\b(?:semanas|meses|persistente|cronica|nao passa)\b/],
    referrals: [{ id: 'pneumologia', score: 27 }, { id: 'clinica-medica', score: 25 }] },

  // DIGESTIVE / ABDOMINAL / PELVIC.
  { id: 'acute-diarrhea', category: 'digestive', sourceId: 'diarrhea', reason: 'Diarreia aguda sem localização de órgão definida: avaliação clínica geral e possível Gastroenterologia',
    all: [/\b(?:diarreia|desinteria|disenteria|dissenteria|fezes liquidas|evacuacoes liquidas|intestino solto)\b/, /\b(?:hoje|ontem|comecou|inicio|repente|aguda|febre|vomito|nausea)\b/],
    referrals: [{ id: 'clinica-medica', score: 29 }, { id: 'gastroenterologia', score: 27 }] },
  { id: 'chronic-diarrhea', category: 'digestive', sourceId: 'diarrhea', reason: 'Alteração persistente do hábito intestinal pode justificar Gastroenterologia',
    all: [/\b(?:diarreia|desinteria|disenteria|fezes moles|fezes liquidas|intestino solto)\b/, /\b(?:semanas|meses|persistente|cronica|repetida|recorrente)\b/],
    referrals: [{ id: 'gastroenterologia', score: 31 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'bloody-stool', category: 'digestive', sourceId: 'diarrhea', reason: 'Sangue nas fezes precisa de avaliação clínica, sem assumir hemorroida ou outra causa',
    all: [/\b(?:sangue nas fezes|fezes com sangue|diarreia com sangue|sangramento retal|sangramento no anus)\b/],
    referrals: [{ id: 'coloproctologia', score: 28 }, { id: 'gastroenterologia', score: 28 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'abdominal-vomit-fever', category: 'digestive', sourceId: 'diarrhea', reason: 'Dor abdominal com febre/vômitos exige avaliar gravidade antes do encaminhamento',
    all: [/\b(?:dor abdominal|dor na barriga|dor no estomago|abdomen dolorido|colica abdominal)\b/, /\b(?:febre|vomito|vomitando|nausea intensa)\b/],
    referrals: [{ id: 'clinica-medica', score: 30 }, { id: 'gastroenterologia', score: 28 }] },
  { id: 'reflux-dyspepsia', category: 'digestive', sourceId: 'primary-referral', reason: 'Refluxo, azia ou regurgitação recorrentes',
    all: [/\b(?:refluxo|azia|regurgitacao|queimacao no estomago|ma digestao)\b/, /\b(?:frequente|recorrente|piora|apos comer|semanas|meses|persistente|noite)\b/],
    referrals: [{ id: 'gastroenterologia', score: 30 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'anal-local', category: 'digestive', sourceId: 'primary-referral', reason: 'Queixa anorretal persistente pode justificar Coloproctologia',
    all: [/\b(?:anus|retal|anal|hemorroida|fissura anal|reto)\b/, /\b(?:dor|sangra\w*|caroco|coceira|incomodo)\b/],
    referrals: [{ id: 'coloproctologia', score: 30 }] },
  { id: 'upper-abdomen', category: 'digestive', sourceId: 'primary-referral', reason: 'Dor alta do abdome requer avaliação inicial sem presumir órgão ou diagnóstico',
    all: [/\b(?:hipocondrio|epigastrio|parte alta da barriga|parte de cima da barriga|lado direito da barriga)\b/, /\b(?:dor|colica|desconforto|nausea|vomito)\b/],
    referrals: [{ id: 'clinica-medica', score: 27 }, { id: 'gastroenterologia', score: 25 }] },
  // CROSS-SYSTEM ANATOMY: no single anatomical name (pubis, groin, axilla,
  // flank) determines its organ of origin. Require independent associated clues.
  { id: 'pubic-after-exertion', category: 'pelvic', sourceId: 'aafp-groin',
    reason: 'Dor na região pubiana após esporte, queda ou esforço pode merecer avaliação musculoesquelética; hérnia e outras causas não estão excluídas',
    all: [/\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica|pelve|virilha|inguinal)\b/, /\b(?:dor|fisgada|puxao|desconforto)\b/, /\b(?:corrida|correr|correu|academia|treino|exercicio|esforco|musculacao|pancada|queda)\b/],
    referrals: [{ id: 'ortopedia', score: 31 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'pubic-urinary-symptoms', category: 'pelvic', sourceId: 'merck-urologic',
    reason: 'Dor suprapúbica com sintomas urinários requer avaliação do trato urinário, não por localização isolada',
    all: [/\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica|pelve|pelvica|baixo ventre|virilha|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano)\b/, /\b(?:dor|pressao|desconforto|ardencia)\b/, /\b(?:ardencia (?:ao|para) urinar|dor ao urinar|disuria|sangue na urina|urina com sangue|jato urinario|dificuldade para urinar|nao consigo urinar)\b/],
    referrals: [{ id: 'urologia', score: 32 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'pubic-bulge-hernia-question', category: 'pelvic', sourceId: 'aafp-groin',
    reason: 'Abaulamento em virilha ou púbis, especialmente após esforço, deve suscitar avaliação de hérnia e urgência conforme sintomas',
    all: [/\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|virilha|inguinal|baixo ventre)\b/, /\b(?:abaulamento|caroco|calombo|saliencia|protuberancia|hernia)\b/],
    referrals: [{ id: 'cirurgia-geral', score: 32 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'pubic-digestive-symptoms', category: 'pelvic', sourceId: 'merck-abdominal',
    reason: 'Dor baixa acompanhada de sintomas intestinais requer avaliação clínica/digestiva, não encaminhamento urinário automático',
    all: [/\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|baixo ventre|pelve|pelvica|virilha)\b/, /\b(?:dor|colica|desconforto)\b/, /\b(?:diarreia|constipacao|prisao de ventre|sangue nas fezes|dor ao evacuar|fezes com sangue)\b/],
    referrals: [{ id: 'clinica-medica', score: 32 }, { id: 'gastroenterologia', score: 29 }] },
  { id: 'pubic-gynecologic-context', category: 'pelvic', sourceId: 'aafp-acute-pelvic',
    reason: 'Dor pélvica com alterações ginecológicas ou possibilidade de gravidez requer avaliação contextual, primeiro avaliando sinais de urgência',
    all: [/\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|pelve|pelvica|baixo ventre|virilha|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano)\b/, /\b(?:dor|colica|desconforto)\b/, /\b(?:menstruacao|menstrual|sangramento vaginal|corrimento vaginal|gravidez|gestante|ovario|utero)\b/],
    referrals: [{ id: 'ginecologia', score: 32 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'axilla-rash', category: 'cross-system', sourceId: 'primary-referral',
    reason: 'Axila com manchas, prurido ou erupção favorece avaliação cutânea, não por ser axila isoladamente',
    all: [/\b(?:axila|axilas|embaixo do braco|debaixo do braco)\b/, /\b(?:bolinhas|manchas|vermelhidao|vermelho|avermelhada|coceira|prurido|ferida|erupcao|descamacao)\b/],
    referrals: [{ id: 'dermatologia', score: 29 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'axilla-after-load', category: 'cross-system', sourceId: 'orthopedics',
    reason: 'Dor axilar relacionada ao movimento ou esforço pode ser musculoesquelética; observar outros sintomas',
    all: [/\b(?:axila|axilas|embaixo do braco|debaixo do braco)\b/, /\b(?:dor|doendo|fisgada|puxao)\b/, /\b(?:academia|treino|exercicio|esforco|levantou peso|carregou|movimentar|pancada)\b/],
    referrals: [{ id: 'ortopedia', score: 28 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'axilla-node', category: 'cross-system', sourceId: 'primary-referral',
    reason: 'Nódulo axilar deve ser avaliado clinicamente; localização isolada não justifica Dermatologia ou Mastologia',
    all: [/\b(?:axila|axilas|embaixo do braco|debaixo do braco)\b/, /\b(?:caroco|nodulo|ganglio|linfonodo|massa)\b/],
    referrals: [{ id: 'clinica-medica', score: 31 }] },
  { id: 'flank-urinary', category: 'cross-system', sourceId: 'merck-urologic',
    reason: 'Dor no flanco com sintomas urinários merece avaliação clínica do trato urinário e sinais sistêmicos',
    all: [/\b(?:flanco|lateral da barriga|lado da barriga)\b/, /\b(?:dor|colica|desconforto)\b/, /\b(?:urinar|disuria|sangue na urina|urina com sangue|ardencia ao urinar|ardencia para urinar)\b/],
    referrals: [{ id: 'clinica-medica', score: 30 }, { id: 'urologia', score: 29 }] },
  { id: 'flank-after-strain', category: 'cross-system', sourceId: 'orthopedics',
    reason: 'Dor lateral após esforço com características mecânicas pode ser musculoesquelética',
    all: [/\b(?:flanco|lateral da barriga|lado da barriga)\b/, /\b(?:dor|fisgada|puxao)\b/, /\b(?:academia|treino|esforco|correr|exercicio|pancada|queda|movimentar)\b/],
    referrals: [{ id: 'ortopedia', score: 29 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'genital-skin-lesions', category: 'genital', sourceId: 'primary-referral',
    reason: 'Lesões visíveis de pele na glande/genitais podem exigir avaliação dermatológica ou urológica, sem presumir IST',
    all: [/\b(?:glande|prepucio|penis|genital|escroto)\b/, /\b(?:bolinhas|manchas|vermelh\w*|lesao|lesoes|coceira|ferid\w*|placas?)\b/],
    referrals: [{ id: 'dermatologia', score: 30 }, { id: 'urologia', score: 29 }] },
  { id: 'pelvic-unspecified', category: 'pelvic', sourceId: 'primary-referral', reason: 'Dor pélvica não é suficiente para presumir etiologia urinária, ginecológica ou musculoesquelética',
    all: [/\b(?:pelve|pelvica|pelvico|virilha|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica|baixo ventre)\b/, /\b(?:dor|colica|espasm\w*|desconforto)\b/],
    referrals: [{ id: 'clinica-medica', score: 26 }] },
  { id: 'pelvic-after-exertion', category: 'pelvic', sourceId: 'orthopedics', reason: 'Dor pélvica/inguinal após esforço com característica musculoesquelética',
    all: [/\b(?:pelve|pelvica|virilha|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|quadril)\b/, /\b(?:corrida|correu|academia|treino|esforco|musculacao)\b/, /\b(?:dor|fisgada|puxao|espasmo)\b/],
    referrals: [{ id: 'ortopedia', score: 30 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'pelvic-urinary', category: 'pelvic', sourceId: 'primary-referral', reason: 'Dor pélvica com disúria ou alteração urinária exige avaliar o trato urinário',
    all: [/\b(?:pelve|pelvica|baixo ventre|virilha|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano)\b/, /\b(?:ardencia ao urinar|dor ao urinar|urina com sangue|urinar muito|bexiga)\b/],
    referrals: [{ id: 'urologia', score: 30 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'pelvic-gynecologic', category: 'pelvic', sourceId: 'primary-referral', reason: 'Dor pélvica associada a sangramento/ciclo ou sintomas ginecológicos',
    all: [/\b(?:pelve|pelvica|baixo ventre|virilha|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano)\b/, /\b(?:menstrual|menstruacao|sangramento vaginal|corrimento vaginal|ovario|utero)\b/],
    referrals: [{ id: 'ginecologia', score: 32 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'urinary-burning', category: 'urinary', sourceId: 'primary-referral', reason: 'Ardência ao urinar/dor urinária: avaliação do trato urinário, sem afirmar infecção',
    all: [/\b(?:ardencia ao urinar|dor ao urinar|queima ao urinar|urina ardendo|ardor na urina|disuria)\b/],
    referrals: [{ id: 'urologia', score: 28 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'urinary-fever-flank', category: 'urinary', sourceId: 'primary-referral', reason: 'Febre com dor lombar/flanco e queixa urinária pede avaliação presencial rápida',
    all: [/\b(?:febre|calafri\w*)\b/, /\b(?:ardencia ao urinar|dor ao urinar|urina|bexiga|disuria)\b/, /\b(?:rins?|flanco|lombar|costas)\b/],
    referrals: [{ id: 'clinica-medica', score: 31 }, { id: 'urologia', score: 29 }] },
  { id: 'renal-chronic', category: 'urinary', sourceId: 'primary-referral', reason: 'Alteração renal laboratorial ou doença renal conhecida merece avaliação médica',
    all: [/\b(?:creatinina|proteinuria|insuficiencia renal|doenca renal|filtracao renal)\b/],
    referrals: [{ id: 'nefrologia', score: 28 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'testicular-pain', category: 'urinary', sourceId: 'testicular', reason: 'Dor testicular precisa de avaliação clínica/urológica; início súbito e intenso é emergência',
    all: [/\b(?:testiculo|testiculos|bolsa escrotal|escroto)\b/, /\b(?:dor|inchado|inchaco|desconforto)\b/],
    referrals: [{ id: 'urologia', score: 30 }] },

  // CARDIOVASCULAR / NEURO / ENDOCRINE / OTHER SYSTEMS.
  { id: 'palpitations', category: 'cardiac', sourceId: 'primary-referral', reason: 'Palpitação persistente exige avaliar padrão e sintomas associados',
    all: [/\b(?:palpitacao|palpitacoes|coracao acelerado|taquicardia|batimento irregular)\b/],
    referrals: [{ id: 'cardiologia', score: 28 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'presyncope', category: 'cardiac', sourceId: 'neurology', reason: 'Tontura acompanhada de palpitações ou sensação de desmaio',
    all: [/\b(?:tontura|quase desmaiei|vou desmaiar|vista escureceu|fraqueza)\b/, /\b(?:palpitacao|coracao acelerado|batimento irregular|pressao baixa|ao levantar)\b/],
    referrals: [{ id: 'clinica-medica', score: 29 }, { id: 'cardiologia', score: 27 }] },
  { id: 'vertigo-ear', category: 'neurological', sourceId: 'neurology', reason: 'Vertigem com queixa auditiva pode justificar Otorrinolaringologia',
    all: [/\b(?:vertigem|tudo girando|ambiente girando|tontura)\b/, /\b(?:zumbido|ouvido|perda auditiva|audicao)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 28 }, { id: 'neurologia', score: 26 }] },
  { id: 'chronic-headache', category: 'neurological', sourceId: 'neurology', reason: 'Cefaleia recorrente com padrão caracterizado',
    all: [/\b(?:enxaqueca|cefaleia|dor de cabeca)\b/, /\b(?:frequente|recorrente|semanas|meses|toda semana|todo dia)\b/],
    referrals: [{ id: 'neurologia', score: 30 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'memory-older', category: 'geriatric', sourceId: 'neurology', reason: 'Esquecimento e perda de autonomia em pessoa idosa',
    demographic: 'older', all: [/\b(?:memoria|esquec\w*|confusao|desorientacao)\b/, /\b(?:frequente|recorrente|piorando|dificuldade|autonomia|quedas|meses)\b/],
    referrals: [{ id: 'geriatria', score: 30 }, { id: 'neurologia', score: 28 }] },
  { id: 'frailty-older', category: 'geriatric', sourceId: 'primary-referral', reason: 'Fragilidade, quedas recorrentes e problemas simultâneos na pessoa idosa',
    demographic: 'older', all: [/\b(?:quedas|fragilidade|perda de autonomia|muitos remedios|polifarmacia|declinio funcional)\b/],
    referrals: [{ id: 'geriatria', score: 29 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'polyuria-polydipsia', category: 'endocrine', sourceId: 'primary-referral', reason: 'Sede excessiva e urinar em excesso exigem avaliação clínica/metabólica',
    all: [/\b(?:muita sede|sede excessiva|bebe muita agua|polidipsia)\b/, /\b(?:urino muito|urinar muito|urinando muito|poliuria|fazendo muito xixi)\b/],
    referrals: [{ id: 'clinica-medica', score: 29 }, { id: 'endocrinologia', score: 28 }] },
  { id: 'thyroid-symptoms', category: 'endocrine', sourceId: 'primary-referral', reason: 'Queixas relacionadas à tireoide/metabolismo',
    all: [/\b(?:tireoide|hipotireoidismo|hipertireoidismo|tsh|t4 livre)\b/],
    referrals: [{ id: 'endocrinologia', score: 28 }] },
  { id: 'breast-lump', category: 'breast', sourceId: 'primary-referral', reason: 'Nódulo ou alteração localizada de mama exige avaliação presencial',
    all: [/\b(?:mama|seio|mamilo|mamas)\b/, /\b(?:nodulo|caroco|massa|secrecao|sangramento)\b/],
    referrals: [{ id: 'mastologia', score: 30 }, { id: 'ginecologia', score: 26 }] },
  { id: 'gynecological-bleeding', category: 'gynecologic', sourceId: 'primary-referral', reason: 'Alteração do fluxo ou sangramento ginecológico fora de situação de emergência',
    all: [/\b(?:menstruacao|menstrual|vaginal|utero)\b/, /\b(?:sangra\w*|fluxo intenso|irregular|atras\w*|colica)\b/],
    referrals: [{ id: 'ginecologia', score: 30 }] },
  { id: 'skin-persistent', category: 'skin', sourceId: 'primary-referral', reason: 'Mancha, lesão, irritação ou coceira cutânea persistente',
    all: [/\b(?:pele|cutaneo|cutanea|mancha|lesao|coceira|prurido|verruga)\b/, /\b(?:persistente|meses|semanas|recorrente|descamacao|eczema|psoriase)\b/],
    referrals: [{ id: 'dermatologia', score: 28 }] },
  { id: 'leg-venous', category: 'vascular', sourceId: 'primary-referral', reason: 'Edema assimétrico ou dor unilateral de perna merece avaliação de causa vascular',
    all: [/\b(?:perna|panturrilha|membro inferior)\b/, /\b(?:inchada|inchaco|edema|dor)\b/, /\b(?:so de um lado|apenas uma|unilateral|uma perna|uma panturrilha)\b/],
    referrals: [{ id: 'clinica-medica', score: 28 }, { id: 'cirurgia-vascular', score: 27 }, { id: 'angiologia', score: 26 }] },
  { id: 'anemia-abnormal', category: 'blood', sourceId: 'primary-referral', reason: 'Alterações hematológicas documentadas podem justificar Hematologia após avaliação inicial',
    all: [/\b(?:anemia|plaquetas baixas|leucocitos baixos|hemoglobina baixa|coagulacao)\b/, /\b(?:exame|persistente|semanas|meses|repetido|recorrente|diagnosticad\w*)\b/],
    referrals: [{ id: 'hematologia', score: 28 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'mood-persistent', category: 'mental', sourceId: 'primary-referral', reason: 'Alteração persistente de humor, ansiedade ou comportamento',
    all: [/\b(?:ansiedade|depressao|humor|crise de panico|insomnia|insonia)\b/, /\b(?:semanas|meses|frequente|recorrente|nao consigo trabalhar|prejudica minha vida|dificuldade)\b/],
    referrals: [{ id: 'psiquiatria', score: 27 }, { id: 'clinica-medica', score: 24 }] },
  { id: 'skin-scalp-hair', category: 'skin', sourceId: 'primary-referral', reason: 'Queda/alteração capilar persistente pode merecer Dermatologia',
    all: [/\b(?:cabelo|couro cabeludo|alopecia|calvicie)\b/, /\b(?:caindo|queda|falhando|falhas|descamacao|coceira|meses)\b/],
    referrals: [{ id: 'dermatologia', score: 27 }] },
  { id: 'skin-recurrent-hives', category: 'skin', sourceId: 'primary-referral', reason: 'Urticária/erupção pruriginosa recorrente requer avaliação de pele e possíveis desencadeantes',
    all: [/\b(?:urticaria|placas vermelhas|verg[oõ]es|coceira na pele)\b/, /\b(?:recorrente|coceira|persistente|semanas)\b/],
    referrals: [{ id: 'dermatologia', score: 28 }, { id: 'alergologia-imunologia', score: 26 }] },
  { id: 'ent-recurrent-epistaxis', category: 'ent', sourceId: 'primary-referral', reason: 'Sangramento nasal recorrente exige investigação da região e de fatores sistêmicos',
    all: [/\b(?:nariz|nasal|narina)\b/, /\b(?:sangramento|sangra|sangrando|sangue)\b/, /\b(?:recorrente|sempre|frequente|repetid\w*|toda semana)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 29 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'ent-unilateral-tinnitus', category: 'ent', sourceId: 'nice-hearing', reason: 'Zumbido unilateral persistente pode requerer investigação otorrinolaringológica',
    all: [/\b(?:zumbido|apito no ouvido|chiado no ouvido)\b/, /\b(?:unilateral|um ouvido|um lado|sempre|persistente|meses)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 28 }] },
  { id: 'ent-sinus-pressure', category: 'ent', sourceId: 'primary-referral', reason: 'Pressão facial/nasal persistente, avaliada junto com sintomas de vias aéreas superiores',
    all: [/\b(?:seios da face|face|macas do rosto|testa|nariz)\b/, /\b(?:pressao|dor|peso)\b/, /\b(?:congestao|coriza|secrecao nasal|nariz entupido)\b/],
    referrals: [{ id: 'otorrinolaringologia', score: 28 }, { id: 'clinica-medica', score: 26 }] },
  { id: 'urinary-frequent-nocturnal', category: 'urinary', sourceId: 'primary-referral', reason: 'Alteração urinária recorrente precisa de avaliação, sem presumir próstata ou infecção',
    all: [/\b(?:urinar|urina|xixi|bexiga)\b/, /\b(?:noite toda|varias vezes a noite|muitas vezes a noite|nocturia|jato fraco|dificuldade para iniciar|urinar frequentemente)\b/],
    referrals: [{ id: 'urologia', score: 27 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'urinary-blood', category: 'urinary', sourceId: 'primary-referral', reason: 'Sangue na urina requer avaliação presencial, sem concluir a causa',
    all: [/\b(?:sangue na urina|urina com sangue|hematuria|urinando sangue)\b/],
    referrals: [{ id: 'urologia', score: 30 }, { id: 'clinica-medica', score: 27 }] },
  { id: 'urological-testis-lump', category: 'urinary', sourceId: 'testicular', reason: 'Nódulo/alteração palpável do testículo requer avaliação urológica',
    all: [/\b(?:testiculo|testiculos|escroto|bolsa escrotal)\b/, /\b(?:caroco|nodulo|massa|inchado|aumentou de tamanho)\b/],
    referrals: [{ id: 'urologia', score: 29 }] },
  { id: 'gynecologic-discharge', category: 'gynecologic', sourceId: 'primary-referral', reason: 'Corrimento ou irritação vaginal requer avaliação ginecológica quando pertinente',
    all: [/\b(?:vagina|vaginal|vulva)\b/, /\b(?:corrimento|secrecao|coceira|ardencia|irritacao)\b/],
    referrals: [{ id: 'ginecologia', score: 29 }] },
  { id: 'breast-pain-fever', category: 'breast', sourceId: 'primary-referral', reason: 'Dor localizada na mama com febre/vermelhidão necessita avaliação presencial, especialmente em lactação',
    all: [/\b(?:mama|mamas|seio|seios|amamentacao|amamentando)\b/, /\b(?:dor|dolorid\w*|incha\w*|vermelh\w*)\b/, /\b(?:febre|calafrios|quente|vermelh\w*)\b/],
    referrals: [{ id: 'clinica-medica', score: 30 }, { id: 'mastologia', score: 28 }, { id: 'ginecologia', score: 26 }] },
  { id: 'neck-mass-persistent', category: 'head-neck', sourceId: 'primary-referral', reason: 'Nódulo persistente em pescoço/face precisa de avaliação clínica antes de indicação de procedimento',
    all: [/\b(?:pesco[cç]o|cervical|garganta|mandibula|parotida)\b/, /\b(?:caroco|nodulo|massa|incha\w*)\b/, /\b(?:semanas|meses|persistente|crescendo|aumentando)\b/],
    referrals: [{ id: 'clinica-medica', score: 29 }, { id: 'cirurgia-cabeca-pescoco', score: 27 }] },
  { id: 'swallowing-persistent', category: 'digestive', sourceId: 'primary-referral', reason: 'Dificuldade persistente para engolir deve ser avaliada sem presumir a causa',
    all: [/\b(?:engolir|deglutir|disfagia)\b/, /\b(?:dificuldade|engasgo|comida presa|nao desce|trava)\b/, /\b(?:semanas|meses|persistente|recorrente|piorando)\b/],
    referrals: [{ id: 'clinica-medica', score: 29 }, { id: 'gastroenterologia', score: 27 }, { id: 'otorrinolaringologia', score: 25 }] },
  { id: 'neurological-tremor', category: 'neurological', sourceId: 'neurology', reason: 'Tremor recorrente ou progressivo necessita avaliação do padrão neurológico e sistêmico',
    all: [/\b(?:tremor|tremedeira|tremendo)\b/, /\b(?:maos?|bracos?|cabeca|recorrente|persistente|piorando|semanas|meses)\b/],
    referrals: [{ id: 'neurologia', score: 28 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'geriatrics-polypharmacy', category: 'geriatric', sourceId: 'primary-referral', reason: 'Pessoa idosa com múltiplos medicamentos e dúvidas de funcionalidade',
    demographic: 'older', all: [/\b(?:muitos remedios|varios remedios|polifarmacia|multiplos medicamentos|muitas medicacoes)\b/],
    referrals: [{ id: 'geriatria', score: 28 }, { id: 'clinica-medica', score: 25 }] },
  { id: 'adult-fatigue-weight', category: 'general', sourceId: 'primary-referral', reason: 'Emagrecimento não intencional com cansaço persistente exige avaliação inicial geral',
    all: [/\b(?:perda de peso|emagrecendo|emagreci|emagrecimento)\b/, /\b(?:sem querer|sem dieta|sem motivo|sem explicacao)\b/, /\b(?:cansaco|fraqueza|fadiga|indisposicao)\b/],
    referrals: [{ id: 'clinica-medica', score: 31 }] },
  { id: 'adult-chronic-pressure', category: 'cardiac', sourceId: 'primary-referral', reason: 'Pressão arterial persistentemente alterada deve ser avaliada em contexto clínico',
    all: [/\b(?:pressao arterial|hipertensao|pressao alta)\b/, /\b(?:controlar|medicoes|repetidas|persistente|tratamento|acompanhamento)\b/],
    referrals: [{ id: 'clinica-medica', score: 28 }, { id: 'cardiologia', score: 27 }] },
];

export const CASEBOOK_COUNT = D.length;
export const CASEBOOK_REFERENCES: Readonly<Record<string, string>> = {
  fingertip: 'https://medlineplus.gov/ency/article/000018.htm',
  'aafp-groin': 'https://www.aafp.org/afp/2025/0400/groin-pain-injuries',
  'aafp-acute-pelvic': 'https://www.aafp.org/pubs/afp/issues/2023/0800/acute-pelvic-pain.html',
  'merck-urologic': 'https://www.merckmanuals.com/en-ca/professional/genitourinary-disorders/approach-to-the-patient-with-urologic-issues/evaluation-of-the-patient-with-urologic-issues',
  'merck-abdominal': 'https://www.merckmanuals.com/professional/gastrointestinal-disorders/acute-abdomen-and-surgical-gastroenterology/acute-abdominal-pain',
  'nhs-pelvic': 'https://www.nhs.uk/symptoms/pelvic-pain/',
  orthopedics: 'https://bvsms.saude.gov.br/bvs/publicacoes/protocolos_encaminhamento_atencao_ortopedia_adulto.pdf',
  'primary-referral': 'https://www.gov.br/saude/pt-br/composicao/saes/drac/protocolos',
  'cdc-respiratory': 'https://www.cdc.gov/common-cold/about/',
  'nhs-eyelid': 'https://www.nhs.uk/symptoms/eyelid-problems/',
  'nhs-eye-pain': 'https://www.nhs.uk/symptoms/eye-pain/',
  'nhs-dvt': 'https://www.nhs.uk/conditions/deep-vein-thrombosis-dvt/',
  'aafp-eye': 'https://www.aafp.org/afp/2024/0800/conjunctivitis',
  neurology: 'https://www.nice.org.uk/guidance/ng127/chapter/Recommendations-for-adults-aged-over-16',
  'nice-hearing': 'https://www.nice.org.uk/guidance/ng98/chapter/recommendations',
  'septic-joint': 'https://www.nice.org.uk/guidance/ng219/chapter/Recommendations',
  diarrhea: 'https://www.health.qld.gov.au/cpc/gastroenterology/diarrhoea',
  testicular: 'https://www.nhs.uk/symptoms/testicle-pain/',
};

function demographicMatch(which: Demographic | undefined, patient: PatientProfile): boolean {
  if (!which) return true;
  if (patient.ageYears === null) return false;
  if (which === 'child') return patient.ageYears < 18;
  if (which === 'adult') return patient.ageYears >= 18;
  return patient.ageYears >= 65;
}

/** Deterministic, pre-compiled and bounded: no network calls in the chat hot path. */
export function matchClinicalCases(evidence: string, patient: PatientProfile): CasebookSignal[] {
  const text = positiveEvidenceText(evidence);
  return D.filter((scenario) => demographicMatch(scenario.demographic, patient) &&
    scenario.all.every((pattern) => pattern.test(text)) &&
    !(scenario.none?.some((pattern) => pattern.test(text)) ?? false))
    // The model receives at most four hints: rank higher-evidence and more
    // discriminating situations first, independent of editorial file order.
    .sort((a, b) => Math.max(...b.referrals.map((ref) => ref.score)) -
        Math.max(...a.referrals.map((ref) => ref.score)) || b.all.length - a.all.length)
    .map(({ id, category, reason, sourceId, referrals, exclude }) => ({ id, category, reason, sourceId, referrals, exclude }));
}

/**
 * Cross-turn urgent findings should not wait for the model. This is a small,
 * conservative backstop, not an exhaustive emergency detection system.
 * A negative symptom is not positive evidence; raw history stays available
 * in the existing safety code for additional warning-sign rules.
 */
export function casebookUrgency(messages: string[]): 'emergency' | 'prompt' | null {
  const text = positiveEvidenceText(messages.map(normalize).join('\n'));
  const has = (pattern: RegExp) => pattern.test(text);
  // NHS pelvic pain / Merck acute abdominal pain: strong pelvic/pubis pain,
  // especially severe or worsening, must be evaluated before elective routing.
  // Positive facts can arrive across multiple messages in the SAME patient episode.
  const pelvicSite = /\b(?:pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano|suprapubica|pelve|pelvica|pelvico|baixo ventre|pe da barriga|virilha|inguinal|perineo)\b/.test(text);
  const pelvicStrong = /\b(?:dor\s+(?:(?:muito|bem|bastante)\s+)?(?:forte|intensa|insuportavel)|dor\s+(?:no|na|do|da|em|sobre|pela|pelo)\s+(?:\w+\s+){0,5}(?:muito\s+forte|forte|intensa|insuportavel)|dor\s+(?:e|esta|ficou)\s+(?:muito\s+)?(?:forte|intensa|insuportavel)|dor\s+excruciante|dor\s+que\s+nao\s+aguento|doendo\s+(?:muito|demais)|piorando\s+(?:rapidamente|muito))\b/.test(text);
  const deniesSevere = /\b(?:nao e|nao esta|nao tenho|nao sinto|sem)\s+(?:uma?\s+)?(?:dor\s+)?(?:muito\s+)?(?:forte|intensa|insuportavel)\b/.test(text);
  if (pelvicSite && pelvicStrong && !deniesSevere) return 'emergency';
  if (pelvicSite && /\b(?:dor|dores|colica|desconforto)\b/.test(text) &&
      /\b(?:febre alta|calafrios intensos|tremores de frio|piorando rapidamente)\b/.test(text)) return 'prompt';
  if (pelvicSite && /\b(?:dor|dores|colica|desconforto)\b/.test(text) &&
      /\b(?:desmaio|desmaiou|quase desmaiou|sangramento intenso|abdomen rigido|barriga dura|vomitos persistentes|dificuldade para urinar|nao consigo urinar|nao consegue urinar)\b/.test(text)) return 'prompt';
  // AAFP acute pelvic pain / NHS pelvic pain: pregnancy-related pelvic pain
  // requires prompt medical evaluation rather than an elective specialty card.
  // Severe bleeding or fainting is handled by the separate emergency guard.
  if (pelvicSite && /\b(?:dor|dores|colica|desconforto)\b/.test(text) &&
      /\b(?:gravida|gestante|gravidez|possivel gravidez|teste de gravidez positivo)\b/.test(text)) return 'prompt';
  // A painful irreducible groin bulge with vomiting can indicate an acute
  // surgical problem and should not become a routine surgery appointment.
  if (/\b(?:virilha|inguinal|pubis|pubica|pubico|pubiana|pubiano|suprapubiana|suprapubiano)\b/.test(text) &&
      /\b(?:abaulamento|caroco|calombo|hernia|saliencia)\b/.test(text) &&
      /\b(?:vomit\w*|nao volta|nao reduz|muito dolorido|dor forte|intensa)\b/.test(text)) return 'emergency';
  // Reference: NHS eyelid problems / eye pain. Red, swollen AND painful
  // lids or significant eye pain/visual changes merit prompt assessment.
  // A merely itchy or puffy eyelid without these features is not emergency.
  if (has(/\b(?:palpebras?|em volta dos olhos|ao redor dos olhos)\b/) &&
      has(/\b(?:inchad\w*|inchaco|edema)\b/) &&
      has(/\b(?:vermelh\w*|avermelhad\w*|quente|calor local)\b/) &&
      has(/\b(?:dor|doi|doendo|dolorid\w*|sensivel ao toque|febre)\b/)) return 'prompt';
  if (has(/\b(?:olhos?|ocular|visao|vista)\b/) &&
      has(/\b(?:dor (?:muito )?(?:forte|intensa)|dor forte no olho|dor intensa no olho|visao (?:embacada|turva)|fotofobia)\b/)) return 'prompt';
  // Unilateral leg pain + swelling has a potentially vascular cause.
  // This should never become routine elective Orthopaedics by keyword.
  if (has(/\b(?:perna|pernas|panturrilha|coxa|membro inferior)\b/) &&
      has(/\b(?:dor|dores|dolorid\w*|doendo|doi)\b/) &&
      has(/\b(?:inchad\w*|inchaco|edema)\b/) &&
      has(/\b(?:unilateral|uma perna|so uma perna|uma das pernas|de um lado|lado esquerdo|lado direito)\b/)) return 'prompt';
  // Sudden severe testicular pain is time-critical, not an elective urology search.
  if (has(/\b(?:testiculo|testiculos|escroto|bolsa escrotal)\b/) &&
      has(/\bdor\b/) && has(/\b(?:subit\w*|repente|intens\w*|muito forte|insuportavel)\b/)) return 'emergency';
  // A new acute focal neurological deficit requires emergency assessment.
  if (has(/\b(?:fraqueza (?:subita|de repente) (?:em um lado|no braco|na perna)|boca torta de repente|fala arrastada de repente|dificuldade de falar de repente)\b/)) return 'emergency';
  if (has(/\b(?:dor|inchaco|incha\w*)\b/) &&
      has(/\b(?:dedos?|indicador|polegar|unha|falange|mao)\b/) &&
      has(/\b(?:prensad\w*|imprensad\w*|imprensou|prensou|prendeu|prendi|esmag\w*|prensament\w*|imprensament\w*|esmagament\w*|entalad\w*)\b/) &&
      has(/\b(?:nao consigo (?:mexer|mover|movimentar|dobrar|esticar)|nao consegue (?:mexer|mover|movimentar|dobrar|esticar)|dificuldade (?:de|para) (?:mexer|movimentar|dobrar|esticar)|deformidade|dedo torto|sem sensibilidade)\b/)) return 'prompt';
  // Worrying acutely inflamed joint: cannot safely classify as routine skin care.
  if (has(/\b(?:joelho|quadril|tornozelo|ombro|cotovelo|punho|articulacao)\b/) &&
      has(/\b(?:inchaco|inchad\w*|edema)\b/) &&
      has(/\b(?:quente|vermelh\w*|calor local)\b/) &&
      has(/\b(?:dor intensa|dor forte|nao consigo movimentar|nao consigo dobrar|dificuldade de movimentar|febre)\b/)) return 'prompt';
  // Sudden hearing loss must not be kept in an elective ENT list.
  if (has(/\b(?:surdez|perda de audicao|perdi a audicao|perda auditiva|nao consigo ouvir|parei de ouvir|audicao sumiu)\b/) &&
      has(/\b(?:de repente|subit\w*|hoje|ontem|acordei)\b/)) return 'prompt';
  if (has(/\b(?:diarreia|disenteria|desinteria|fezes liquidas)\b/) &&
      has(/\b(?:desidratacao grave|nao consigo beber|nao consegue beber|desmaio|quase desmaio|sangue em grande quantidade nas fezes)\b/)) return 'prompt';
  // Urinary symptoms + fever and flank pain: consider prompt in-person assessment.
  if (has(/\b(?:febre|calafrios?)\b/) &&
      has(/\b(?:ardencia ao urinar|dor ao urinar|disuria|urina ardendo)\b/) &&
      has(/\b(?:dor (?:na|nas) costas|dor lombar|dor no flanco|dor (?:nos|no) rins?)\b/)) return 'prompt';
  return null;
}
