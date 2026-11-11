/**
 * Reproducible smoke test for the assembled real backend, with a simulated LLM.
 * Run after: npm run build
 * Does NOT make clinical accuracy or real-Qwen claims.
 */
import assert from 'node:assert/strict';
import { readConfig } from '../build/server/config.js';
import { connectDatabase } from '../build/server/db/database.js';
import { migrate } from '../build/server/db/migrations.js';
import { loadPublicCatalog } from '../build/server/services/public-catalog.js';
import { CatalogRepository } from '../build/server/db/catalog.js';
import { SpecialtyRepository } from '../build/server/db/specialties.js';
import { SpecialtyResolver } from '../build/server/services/specialty-resolver.js';
import { ChatService } from '../build/server/services/chat.js';
import { Retriever } from '../build/server/rag/retrieve.js';
import { demoProvider } from '../build/server/ai/demo.js';
import { chatRequestSchema } from '../build/shared/contracts.js';
import { routeComplaint } from '../build/server/domain/specialty-routing.js';
import { patientProfile } from '../build/server/domain/patient.js';
import { detectUrgency } from '../build/server/domain/safety.js';
import { positiveEvidenceText } from '../build/server/domain/negated-evidence.js';
import { selectEvidenceBackedReferral } from '../build/server/domain/referral-decision.js';
import { assessDetail, careConversation } from '../build/server/domain/clarification.js';
import { careInput } from '../build/server/ai/prompt.js';

let count = 0;
function verify(value, message) { assert.ok(value, message); count++; }
function testRouting(message, expectedFirst) {
  const messages = Array.isArray(message) ? message : [message];
  const routing = routeComplaint(messages, patientProfile(messages));
  verify(routing.candidates[0]?.id === expectedFirst,
    `${JSON.stringify(messages)}: expected ${expectedFirst}; got ${routing.candidates.map(x => `${x.id}:${x.score}`).join(', ')}`);
}

const routeChecks = [
  [['Pálpebras inchadas e avermelhadas desde ontem, sem outro sintoma.'], 'oftalmologia'],
  [['Meu olho está vermelho e coçando.'], 'oftalmologia'],
  [['Meu pai sentiu dor na clavícula.','Começou hoje, não tem outros sintomas.','Ele foi levantar uma televisão e sentiu essa dor.'], 'ortopedia'],
  [['Meu professor está com dor no ombro depois de erguer um objeto pesado, desde ontem.'], 'ortopedia'],
  [['Dores no joelho depois do futebol, desde ontem.'], 'ortopedia'],
  [['Meu pai imprensou a unha do dedo indicador e sente dor e inchaço.'], 'ortopedia'],
  [['Nariz congestionado, febre leve e indisposição desde ontem.'], 'clinica-medica'],
  [['Coriza, febre e ardência nos olhos.'], 'clinica-medica'],
  [['Dor forte no olho e visão embaçada, com coriza e febre.'], 'oftalmologia'],
  [['Tenho coceira na pele com manchas vermelhas desde ontem.'], 'dermatologia'],
  [['Minha mãe está com refluxo e azia frequentes.'], 'gastroenterologia'],
  [['Meu filho de 8 anos está com dor nas amígdalas.'], 'pediatria'],
  [['Meu avô com 78 anos sofre quedas frequentes e fragilidade.'], 'geriatria'],
  [['Tenho diarreia persistente há semanas.'], 'gastroenterologia'],
  [['Estou com dor pélvica e sangramento vaginal.'], 'ginecologia'],
  [['Tenho palpitações e batimentos acelerados.'], 'cardiologia'],
  [['Tenho chiado recorrente no peito há meses.'], 'pneumologia'],
  [['Faz meses que tenho muita dor no nervo ciático.'], 'neurologia'],
  [['Meu ouvido dói e tem secreção.'], 'otorrinolaringologia'],
  [['Meu exame mostrou creatinina elevada.'], 'nefrologia'],
];
for (const args of routeChecks) testRouting(...args);

verify(detectUrgency(['Pálpebras inchadas e vermelhas; às vezes dói.']) === 'prompt', 'Painful red swollen eyelid -> prompt');
verify(detectUrgency(['Pálpebras inchadas e vermelhas, mas não dói.']) === null, 'Denied eye pain does not become urgent');
verify(detectUrgency(['Dor forte no olho e visão embaçada, febre e coriza.']) === 'prompt', 'Important ocular symptoms -> prompt');
verify(detectUrgency(['Minha perna está dolorida, inchada, só de um lado.']) === 'prompt', 'Unilateral swollen painful leg -> prompt');
verify(detectUrgency(['Tenho dor na panturrilha, sem inchaço.']) === null, 'No invented leg swelling');
verify(detectUrgency(['Meu pai imprensou a unha do indicador, tem inchaço e não consegue mover o dedo.']) === 'prompt', 'Finger crush + reduced motion -> prompt');
verify(detectUrgency(['Nariz entupido, coriza, febre baixa.']) === null, 'Ordinary respiratory complaint remains elective');
verify(positiveEvidenceText('Sem febre.\nDepois de levantar uma televisão, senti dor no ombro.').includes('levantar uma televisao'), 'Negation cannot erase next utterance');
verify(!positiveEvidenceText('Pálpebras vermelhas, mas não dói.').includes('doi'), 'Negated eyelid pain ignored');

const clavicle = ['Meu pai tem dor na clavícula.', 'Começou ontem, sem outros sintomas.', 'Foi ao levantar uma televisão.'];
const patient = patientProfile(clavicle);
const routing = routeComplaint(clavicle, patient);
const decided = selectEvidenceBackedReferral(routing, patient, 'clinica-medica', assessDetail(clavicle).known);
verify(decided.specialtyId === 'ortopedia', 'Well-supported clavicle injury beats generic model reply');
verify(JSON.parse(careInput({ message: clavicle.at(-1), history: clavicle.slice(0,-1), navigationHints: [{specialtyId:'ortopedia',reason:'dor após esforço',relativePriority:'primary'}] })).navigationHints[0].specialtyId === 'ortopedia', 'LLM receives structured referral evidence');

const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
try {
  await migrate(db);
  await loadPublicCatalog(db);
  let forced = 'Ortopedia e Traumatologia';
  let invocation = 0;
  let lastInput;
  const provider = {
    ...demoProvider, mode: 'ollama',
    generate: async (input) => {
      invocation++;
      lastInput = input;
      return { urgency:'routine', specialty: forced ? { name: forced } : null, questions:[] };
    },
  };
  const chat = new ChatService(
    new Retriever(db, provider, false), provider,
    new CatalogRepository(db, false),
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
  const send = async (message, history = [], context = null) => chat.answer(chatRequestSchema.parse({message, history, ...(context ? { context } : {})}));

  let answer = await send('Meu pai tem dor na clavícula após levantar uma televisão ontem, não tem outros sintomas.');
  verify(answer.specialty?.id === 'ortopedia', `Explicit clavicle injury not Ortopedia (${answer.specialty?.id})`);
  verify(lastInput.navigationHints.some(x=> x.specialtyId === 'ortopedia'), 'Qwen sees mechanism-based reason');
  verify(answer.clinics.every(c=>c.specialties.includes('ortopedia')), 'Clinics reflect Ortopedia');

  forced = 'Clínica Médica';
  answer = await send('Meu professor está com dor no ombro desde ontem depois de carregar uma televisão, sem outros sintomas.');
  verify(answer.specialty?.id === 'ortopedia', `Broad model should not erase shoulder+load (${answer.specialty?.id})`);

  const priorRounds = { specialtyId:null, clinicIds:[], city:'', insurance:'', care:{round:3, questions:[],askedTopics:['onset_duration','associated_symptoms','trigger'], answeredTopics:['onset_duration','associated_symptoms','trigger']} };
  answer = await send('Ele consegue dormir e movimentar.',
    ['Meu professor está com dor no ombro desde ontem.', 'Surgiu após erguer uma televisão, sem outros sintomas.'], priorRounds);
  verify(answer.specialty?.id === 'ortopedia', `Three rounds should not override known shoulder history (${answer.specialty?.id})`);

  forced = 'Ortopedia e Traumatologia';
  answer = await send('Minha esposa de 40 anos está com congestão nasal e febre leve desde ontem.');
  verify(answer.specialty?.id === 'clinica-medica', 'Incompatible ortho model blocked; general airway care');

  forced = 'Dermatologia';
  answer = await send('Pálpebras inchadas e vermelhas, às vezes dói, desde ontem.');
  verify(answer.mode === 'safety' && answer.clinics.length === 0, 'Painful red swollen eyelids -> priority assessment without elective catalog');

  forced = 'Pneumologia';
  answer = await send('Meu avô sente dor na perna e inchaço de um lado.');
  verify(answer.mode === 'safety' && answer.clinics.length === 0, 'Unilateral leg swelling -> priority assessment without elective catalog');

  forced = 'Dermatologia';
  answer = await send('Meu pai imprensou a unha e o dedo está inchado; não consegue mexer o dedo.');
  verify(answer.mode === 'safety' && answer.clinics.length === 0, 'Finger crush -> priority assessment without cosmetic skin referral');

  const previous = await send('Meu avô está com dor na perna há 2 dias, sem outros sintomas.');
  const oldContext = { ...previous.context, specialtyId:'clinica-medica',care:{round:3, questions:[],askedTopics:['onset_duration','associated_symptoms']} };
  const changedPerson = chatRequestSchema.parse({
    message: 'Meu professor está com dor no ombro direito.',
    history: ['Meu avô está com dor na perna há 2 dias, sem outros sintomas.'],
    context: oldContext,
  });
  const episode = careConversation(changedPerson);
  verify(episode.newPerson && episode.newEpisode && episode.history.length === 0 && episode.care === undefined,
    `Professor must start a new clinical episode: ${JSON.stringify({newPerson:episode.newPerson,newEpisode:episode.newEpisode,history:episode.history,care:episode.care})}`);
  answer = await send(changedPerson.message, changedPerson.history, changedPerson.context);
  verify(answer.status === 'needs_information' && answer.questions.length > 0 && answer.context?.care?.round === 1,
    `New patient must receive first-round relevant questions, not grandfather cap: ${JSON.stringify({status:answer.status,specialty:answer.specialty?.id,questions:answer.questions,round:answer.context?.care?.round})}`);

  answer = await send('Não seria mais indicado Ortopedia?', ['Meu professor está com dor no ombro direito.'], { specialtyId:'clinica-medica', clinicIds:[], city:'',insurance:'' });
  verify(!answer.answer.includes('Atenção sobre medicamentos'), 'Specialty challenge is not a drug request');

  // Safety: no fabricated referral from an entirely unknown condition.
  forced = 'Cardiologia';
  answer = await send('Tenho uma sensação estranha chamada xzqly desde ontem e não sei explicar melhor.');
  verify(answer.specialty?.id !== 'cardiologia', 'Unfamiliar terminology cannot license arbitrary cardiology');
  verify(invocation > 0, 'LLM is used in non-emergency semantic cases');

  console.log(`APROVADO: ${count}/${count} verificações de encaminhamento e conversa com LLM simulada.`);
} finally {
  await db.close();
}
