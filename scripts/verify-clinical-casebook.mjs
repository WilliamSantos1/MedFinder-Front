/** Portable clinical navigation regression smoke test; build first. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeComplaint } from '../build/server/domain/specialty-routing.js';
import { patientProfile } from '../build/server/domain/patient.js';
import { detectUrgency } from '../build/server/domain/safety.js';
import { matchClinicalCases, CASEBOOK_COUNT, CASEBOOK_REFERENCES } from '../build/server/domain/clinical-casebook.js';
import { supportedReferralIds } from '../build/server/domain/referral-validation.js';

let passed = 0;
function check(message, expected, excluded = []) {
  const history = Array.isArray(message) ? message : [message];
  const patient = patientProfile(history);
  const routing = routeComplaint(history, patient);
  const supported = supportedReferralIds(routing, patient);
  assert.ok(supported.includes(expected), `Missing ${expected} for ${history.join(' / ')}; got ${supported.join(', ')}`);
  for (const id of excluded) assert.ok(!supported.includes(id), `Inappropriate ${id} for ${history.join(' / ')}`);
  passed++;
}
function alert(message, urgency) {
  assert.equal(detectUrgency(message), urgency, `Urgency mismatch in ${message.join(' / ')}`);
  passed++;
}
const groups = [
  [
    ['Meu pai prendeu a unha do dedo indicador na cama, teve inchaço.', 'ortopedia', ['dermatologia']],
    ['Ele teve imprensamento na unha do indicador, dor, inchaço e dificuldade de movimentar.', 'cirurgia-mao', ['dermatologia']],
    ['Depois de bater a unha do polegar está dolorida.', 'ortopedia', ['dermatologia']],
    ['Unha engrossada e amarelada há meses, não sofreu batida.', 'dermatologia', []],
    ['Dedo trava quando tento dobrar, com estalo.', 'cirurgia-mao', []],
    ['Mãos ficam formigando de madrugada e os dedos adormecem.', 'cirurgia-mao', []],
    ['Torci o tornozelo jogando futebol, está dolorido.', 'ortopedia', []],
    ['Bati o dedão do pé numa quina, está inchado.', 'ortopedia', []],
    ['Dor na virilha após corrida de ontem.', 'ortopedia', []],
    ['Dor no tríceps após academia.', 'ortopedia', []],
    ['Sinto dor no tendão de Aquiles depois de correr.', 'ortopedia', []],
    ['Dor nas costas após carregar peso.', 'ortopedia', []],
    ['Dor nas costas irradiando para a perna.', 'ortopedia', []],
    ['Articulações de mãos e pés estão rígidas toda manhã.', 'reumatologia', []],
    ['Meu joelho sofreu uma pancada e agora está inchado.', 'ortopedia', []],
  ],
  [
    ['Minha esposa está com nariz congestionado, febre leve e indisposição.', 'clinica-medica', ['ortopedia', 'oftalmologia']],
    ['Minha esposa de 40 anos está com coriza, febre leve e ardência nos olhos.', 'otorrinolaringologia', ['ortopedia', 'oftalmologia']],
    ['Meu nariz fica entupido há meses e espirro muito.', 'otorrinolaringologia', []],
    ['Tenho coceira no nariz, coriza e muitos espirros.', 'alergologia-imunologia', []],
    ['Meu ouvido dói e está saindo secreção.', 'otorrinolaringologia', []],
    ['Minha audição diminuiu de repente, ontem.', 'otorrinolaringologia', []],
    ['Minha garganta está doendo, com amígdalas inflamadas.', 'otorrinolaringologia', []],
    ['Estou rouco há semanas.', 'otorrinolaringologia', []],
    ['Meu olho ficou vermelho e coçando muito.', 'oftalmologia', []],
    ['Meu olho está com dor forte e visão embaçada.', 'oftalmologia', []],
    ['Tenho chiado no peito recorrente à noite.', 'pneumologia', []],
    ['Estou tossindo sem parar há meses.', 'pneumologia', []],
  ],
  [
    ['Meu avô teve diarreia que começou hoje e teve febre.', 'clinica-medica', []],
    ['Sinto disenteria persistente há semanas.', 'gastroenterologia', []],
    ['Estou com fezes com sangue.', 'gastroenterologia', []],
    ['Estou com dor abdominal, febre e vômito.', 'clinica-medica', []],
    ['Azia recorrente e refluxo depois de comer.', 'gastroenterologia', []],
    ['Hemorroida com dor no ânus.', 'coloproctologia', []],
    ['Sinto dor na parte de cima da barriga e enjoo.', 'clinica-medica', []],
    ['Tenho dor na pelve e ardência ao urinar.', 'urologia', []],
    ['Minha esposa tem dor pélvica com sangramento vaginal.', 'ginecologia', []],
    ['Meu exame mostrou creatinina elevada e rins ruins.', 'nefrologia', []],
    ['Estou com dor no testículo.', 'urologia', []],
  ],
  [
    ['Tenho palpitações e coração acelerado.', 'cardiologia', []],
    ['Minha mãe sente tontura e palpitações, parece que vai desmaiar.', 'cardiologia', []],
    ['Tudo fica girando e tenho zumbido no ouvido.', 'otorrinolaringologia', []],
    ['Tenho enxaqueca recorrente há meses.', 'neurologia', []],
    ['Minha mãe de 78 anos tem esquecimento frequente e cai bastante.', 'geriatria', []],
    ['Tenho muita sede e urino muito durante o dia.', 'endocrinologia', []],
    ['Minha tireoide está alterada, TSH alto.', 'endocrinologia', []],
    ['Senti um caroço no seio.', 'mastologia', []],
    ['Menstruação irregular há meses.', 'ginecologia', []],
    ['Meu braço tem uma mancha na pele que descama há meses.', 'dermatologia', []],
    ['Uma perna só está inchada e dolorida, é unilateral.', 'cirurgia-vascular', []],
  ],
];
for (const group of groups) for (const [message, expected, blocked] of group) check(message, expected, blocked);
alert(['Meu pai esmagou a unha do dedo indicador na cama.', 'Tem dor, inchaço, vermelhidão e dificuldade de movimentar.'], 'prompt');
alert(['Minha esposa está sem febre e sem dor no dedo.'], null);
alert(['Meu joelho está inchado, vermelho, quente e tenho febre.'], 'prompt');
alert(['Perdi a audição de repente ontem.'], 'prompt');
alert(['Dor súbita e intensa no testículo.'], 'emergency');
alert(['Estou com diarreia, não consigo beber água e acho que estou desidratado.'], 'prompt');
alert(['Tenho febre, dor lombar e ardência ao urinar.'], 'prompt');

const corpus = JSON.parse(readFileSync('data/routing-regression-cases.json', 'utf8'));
for (const item of corpus) {
  const routing = routeComplaint([item.message], patientProfile([item.message]));
  assert.equal(routing.healthComplaint, true, `Failed health identification: ${item.message}`);
  if (item.type === 'deterministic') assert.equal(routing.deterministicId, item.expected, `Legacy deterministic: ${item.message}`);
  if (item.type === 'candidate') {
    assert.equal(routing.deterministicId, null, `Legacy candidates should remain ambiguous: ${item.message}`);
    for (const id of item.expectedAny ?? []) assert.ok(routing.candidates.some(c=>c.id===id), `Missing legacy candidate ${id}: ${item.message}`);
  }
  if (item.type === 'clarification') {
    assert.equal(routing.deterministicId, null, `Legacy clarification: ${item.message}`);
    for (const topic of item.expectedTopics ?? []) assert.ok(routing.clarificationTopics.includes(topic), `Missing legacy clarification ${topic}: ${item.message}`);
  }
  if (item.type === 'semantic-fallback') assert.equal(routing.deterministicId, null, `Legacy semantic fallback: ${item.message}`);
  passed++;
}
assert.ok(CASEBOOK_COUNT >= 50);
assert.ok(Object.keys(CASEBOOK_REFERENCES).length >= 8);
assert.ok(matchClinicalCases('unha prensada e dedo dolorido', patientProfile(['unha prensada e dedo dolorido'])).length > 0);
console.log(`Clinical casebook: ${CASEBOOK_COUNT} reviewed navigation scenarios; ${passed} direct checks passed.`);
