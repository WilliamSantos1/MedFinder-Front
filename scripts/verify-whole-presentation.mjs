import assert from 'node:assert/strict';
import { patientProfile } from '../build/server/domain/patient.js';
import { routeComplaint } from '../build/server/domain/specialty-routing.js';
import { supportedReferralIds } from '../build/server/domain/referral-validation.js';
import { updateSymptomLedger, currentReferralEvidence } from '../build/server/domain/symptom-ledger.js';

let passed = 0;
const check = (label, run) => { run(); passed++; console.log(`✓ ${label}`); };
const initial = 'Boa noite, estou sentindo coriza, ardência nos olhos e febre leve.';
const onset = 'Começou ontem à noite.';
const improvement = 'A ardência nos olhos passou, agora só coriza.';
const impact = 'Está incomodando um pouco.';
let facts = [];
for (const entry of [initial, onset]) facts = updateSymptomLedger(facts, entry);
const firstEvidence = currentReferralEvidence([initial, onset], facts);
const firstProfile = patientProfile([initial, onset]);
const firstRouting = routeComplaint([initial, onset], firstProfile, firstEvidence);
const firstIds = supportedReferralIds(firstRouting, firstProfile);
check('Relato com febre + coriza + olhos: Clínica Médica em primeiro', () => assert.equal(firstRouting.candidates[0].id,'clinica-medica'));
check('Otorrinolaringologia continua plausível no primeiro relato', () => assert.ok(firstIds.includes('otorrinolaringologia')));
check('Oftalmologia não domina manifestação ocular leve + sintomas sistêmicos', () => assert.ok(!firstIds.includes('oftalmologia')));
check('Ortopedia excluída do encaminhamento respiratório', () => assert.ok(!firstIds.includes('ortopedia')));

facts = updateSymptomLedger(facts, improvement);
check('Sintoma ocular que passou fica resolvido, coriza segue ativa', () => {
  assert.equal(facts.find(x=>x.key==='irritacao-ocular')?.status, 'resolved');
  assert.equal(facts.find(x=>x.key==='coriza')?.status, 'active');
  assert.equal(facts.find(x=>x.key==='febre')?.status, 'resolved');
});
const messages = [initial, onset, improvement, impact];
const evidence = currentReferralEvidence(messages, facts);
const profile = patientProfile(messages);
const referral = routeComplaint(messages, profile, evidence);
const supported = supportedReferralIds(referral, profile);
check('Depois de melhorar os olhos, Oftalmologia não é sugestão plausível', () => assert.ok(!supported.includes('oftalmologia')));
check('Depois da melhora ocular, ENT/Clínica Médica permanecem plausíveis', () => assert.ok(supported.includes('otorrinolaringologia') && supported.includes('clinica-medica')));

const eyeOnly = ['Meu olho está vermelho e coçando.'];
const er = routeComplaint(eyeOnly, patientProfile(eyeOnly));
check('Olho vermelho e coçando sem sintomas sistêmicos continua Oftalmologia', () => assert.equal(er.candidates[0]?.id,'oftalmologia'));
const foot = ['Estou com dor no pé depois da corrida.'];
const fr=routeComplaint(foot,patientProfile(foot));
check('Dor no pé continua com Ortopedia como primeira hipótese',()=>assert.equal(fr.candidates[0]?.id,'ortopedia'));
const cough=['Tenho tosse e febre leve.'];
const cr=routeComplaint(cough,patientProfile(cough));
check('Febre + tosse recebe avaliação geral como primeiro destino',()=>assert.equal(cr.candidates[0]?.id,'clinica-medica'));
const denial=['Tenho coriza, mas não tenho febre nem dor nos olhos.'];
let d=updateSymptomLedger([],denial[0]);
const dr=routeComplaint(denial,patientProfile(denial),currentReferralEvidence(denial,d));
check('Sintomas negados não viram evidência positiva',()=>assert.ok(!supportedReferralIds(dr,patientProfile(denial)).includes('oftalmologia')));
console.log(`\n${passed}/${passed} verificações aprovadas`);

// Complete backend flow with PGlite, specialty catalog and a deliberately
// incorrect or correct simulated LLM. Never touches local user data.
const { readConfig } = await import('../build/server/config.js');
const { connectDatabase } = await import('../build/server/db/database.js');
const { migrate } = await import('../build/server/db/migrations.js');
const { loadPublicCatalog } = await import('../build/server/services/public-catalog.js');
const { CatalogRepository } = await import('../build/server/db/catalog.js');
const { SpecialtyRepository } = await import('../build/server/db/specialties.js');
const { SpecialtyResolver } = await import('../build/server/services/specialty-resolver.js');
const { Retriever } = await import('../build/server/rag/retrieve.js');
const { ChatService } = await import('../build/server/services/chat.js');
const { demoProvider } = await import('../build/server/ai/demo.js');
const { chatRequestSchema } = await import('../build/shared/contracts.js');
const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
try {
  await migrate(db);
  await loadPublicCatalog(db);
  let suggested = 'Oftalmologia';
  let candidates = [];
  const provider = { ...demoProvider, mode: 'ollama', async generate(input) {
    candidates = input.specialties.map((candidate) => candidate.id);
    return { urgency: 'routine', specialty: {name: suggested}, questions: [] };
  }};
  const chat = new ChatService(new Retriever(db, provider, false), provider,
    new CatalogRepository(db, false), new SpecialtyResolver(new SpecialtyRepository(db)));
  const send = (message, history=[], context) => chat.answer(chatRequestSchema.parse({
    message, history, ...(context ? {context}:{}),
  }));
  const first = await send(initial);
  check('LLM que insiste em Oftalmologia é rejeitada em quadro sistêmico',()=> assert.equal(first.specialty?.id,'clinica-medica'));
  check('Qwen recebe candidatas clinicamente coerentes',()=>assert.deepEqual(candidates.sort(),['clinica-medica','otorrinolaringologia'].sort()));
  check('Catálogo não mostra clínicas apenas de Oftalmologia',()=>assert.ok(first.clinics.every(c=>c.specialties.includes('clinica-medica'))));
  suggested = 'Otorrinolaringologia';
  const newMessage = 'A ardência nos olhos passou, agora só coriza.';
  const second = await send(newMessage, [initial], first.context);
  check('LLM usa o sintoma atual para mudar encaminhamento ao ENT',()=>assert.equal(second.specialty?.id,'otorrinolaringologia'));
  check('Estado ocular resolvido persistido no contexto',()=>assert.equal(second.context?.symptomState.find(x=>x.key==='irritacao-ocular')?.status,'resolved'));
  check('Clínicas retornadas atendem a especialidade atual',()=>assert.ok(second.clinics.every(c=>c.specialties.includes('otorrinolaringologia'))));
  suggested = 'Oftalmologia';
  const third = await send('Está incomodando um pouco.', [initial,newMessage], second.context);
  check('Oftalmologia antiga não volta após resposta sobre impacto',()=>assert.notEqual(third.specialty?.id,'oftalmologia'));
  const other = await send('Agora meu pai está com dor no pé.',[initial,newMessage],third.context);
  check('Novo paciente não herda coriza nem irritação ocular',()=>assert.equal(other.context?.symptomState.some(x=>x.key==='coriza'),false));
  console.log('Integração backend completa: 8/8 verificada');
} finally { await db.close(); }
