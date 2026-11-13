/** Offline full-service checks using an explicitly simulated LLM, NOT Qwen. */
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

const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
let count = 0;
const check = (condition, label) => { assert.ok(condition, label); count++; };
try {
  await migrate(db);
  await loadPublicCatalog(db);
  let modelSpecialty = 'Urologia';
  let llmCalls = 0;
  let lastModelInput = null;
  const provider = {
    ...demoProvider,
    mode: 'ollama',
    generate: async (input) => {
      llmCalls++;
      lastModelInput = input;
      return { urgency: 'routine', specialty: modelSpecialty ? { name: modelSpecialty } : null, questions: [] };
    },
  };
  const chat = new ChatService(
    new Retriever(db, provider, false), provider,
    new CatalogRepository(db, false),
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
  const send = (message, history = [], context = null) => chat.answer(chatRequestSchema.parse({
    message, history, ...(context ? { context } : {}),
  }));

  const initial = 'Meu pai esta com dor na regiao do pubis.';
  const first = await send(initial);
  check(first.status === 'needs_information' && !first.specialty, 'Pubis should ask, not offer urology');
  check(first.questions.some(q => /urinar/.test(q)), 'Ask about urinary vs other systems');
  check(!first.clinics.length, 'Do not expose elective clinics before context');
  check(llmCalls === 1, 'Ollama must interpret ambiguous anatomy from the first complaint');
  const answer2 = 'Começou ontem. Sem outro sintoma.';
  const second = await send(answer2, [initial], first.context);
  check(second.status === 'needs_information' && second.questions.some(q => /esforço|exercício/.test(q)),
    'Second step asks for mechanism rather than choosing urology');
  const answer3 = 'Sem esforço, sem pancada, apareceu sem causa clara.';
  const third = await send(answer3, [initial, answer2], second.context);
  check(third.specialty?.id === 'clinica-medica' && third.clinics.every(c => c.specialties.includes('clinica-medica')),
    'Do not promote urology when no urinary evidence appears');

  llmCalls = 0;
  modelSpecialty = 'Urologia';
  const urinary = await send('Meu pai esta com dor no pubis e ardencia ao urinar desde ontem.');
  check(urinary.specialty?.id === 'urologia', 'Urinary evidence should permit Urology');
  check(urinary.clinics.every(c => c.specialties.includes('urologia')), 'Urology catalog follows validated referral');
  check(llmCalls === 1 && lastModelInput.specialties.some(x => x.id === 'urologia'), 'LLM receives valid urologic candidate');

  const pubicDanger = await send('Meu pai esta com dor forte e constante no pubis desde ontem.');
  check(pubicDanger.mode === 'safety' && pubicDanger.clinics.length === 0, 'Severe pelvic pain stops elective catalog');
  check(pubicDanger.urgency === 'emergency', 'Severe pelvic pain gets immediate assessment priority');

  modelSpecialty = 'Urologia';
  const groin = await send('Estou com dor na virilha e percebi um abaulamento depois de fazer esforço ontem, sem febre.');
  check(groin.specialty?.id !== 'urologia', 'Urology cannot override a groin bulge with no urinary features');

  const rash = await send('Apareceram bolinhas vermelhas na glande desde ontem, sem outros sintomas.');
  check(rash.specialty?.id === 'dermatologia' || rash.specialty?.id === 'urologia', 'Skin/genital referral should remain plausible');

  modelSpecialty = 'Dermatologia';
  const axilla = await send('Tenho dor na axila.');
  check(axilla.status === 'needs_information' && !axilla.specialty && axilla.questions.length > 0,
    'Armpit pain alone cannot become Dermatology');
  const axillaRash = await send('Tenho bolinhas vermelhas na axila e coceira desde ontem, sem outros sintomas.');
  check(axillaRash.specialty?.id === 'dermatologia', 'Axillary skin findings support Dermatology');

  const priorOther = await send('Tenho bolinhas avermelhadas na glande desde ontem, sem outros sintomas.');
  const swapped = await send('Obrigado, agora meu pai esta com dor no pubis.',
    ['Tenho bolinhas avermelhadas na glande desde ontem, sem outros sintomas.'], priorOther.context);
  check(swapped.status === 'needs_information' && !swapped.specialty, 'New father must not inherit glans/Urology');

  modelSpecialty = 'Ortopedia e Traumatologia';
  const respiratory = await send('Coriza, febre leve e ardência nos olhos desde ontem.');
  check(respiratory.specialty?.id === 'clinica-medica', 'Respiratory multisystem primary care survives the changes');
  const crushed = await send('Meu pai prensou o dedo da mão e está com inchaço e dificuldade para movimentar.');
  check(crushed.mode === 'safety' && !crushed.clinics.length, 'Finger crush with functional limitation remains prompt');

  console.log(`Anatomical chat integration: ${count} checks passed (simulated LLM).`);
} finally {
  await db.close();
}
