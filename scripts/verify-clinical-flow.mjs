/** Build first; verifies catalog and guardrails without connecting to Ollama. */
import assert from 'node:assert/strict';
import { readConfig } from '../build/server/config.js';
import { connectDatabase } from '../build/server/db/database.js';
import { migrate } from '../build/server/db/migrations.js';
import { loadPublicCatalog } from '../build/server/services/public-catalog.js';
import { CatalogRepository } from '../build/server/db/catalog.js';
import { SpecialtyRepository } from '../build/server/db/specialties.js';
import { SpecialtyResolver } from '../build/server/services/specialty-resolver.js';
import { Retriever } from '../build/server/rag/retrieve.js';
import { ChatService } from '../build/server/services/chat.js';
import { demoProvider } from '../build/server/ai/demo.js';
import { chatRequestSchema } from '../build/shared/contracts.js';

let checks = 0;
const verify = (value, message) => { assert.ok(value, message); checks++; };
const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
try {
  await migrate(db);
  await loadPublicCatalog(db);
  let forced = 'Dermatologia';
  let actualSpecialties = [];
  const provider = {
    ...demoProvider,
    mode: 'ollama',
    generate: async ({ specialties }) => {
      actualSpecialties = (specialties ?? []).map(s => s.id);
      return { urgency: 'routine', specialty: { name: forced }, questions: [] };
    },
  };
  const service = new ChatService(
    new Retriever(db, provider, false), provider,
    new CatalogRepository(db, false),
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
  const answer = (input) => service.answer(chatRequestSchema.parse(input));

  // User's real dialogue: mechanism + reduced motion must outrank elective clinics.
  const injury = await answer({
    message: 'Dor, inchaço, vermelhidão e dificuldade de movimentar a região também.',
    history: [
      'Obrigado, agora é com meu pai, ele está com dor na ponta da unha.',
      'Na ponta da unha do dedo indicador, começou hoje após um imprensamento na cama.',
    ],
  });
  verify(injury.mode === 'safety', 'Finger crush must bypass elective LLM/navigation');
  verify(injury.urgency === 'prompt', 'Finger crush and motion restriction -> same-day assessment');
  verify(injury.clinics.length === 0, 'No elective Dermatologia clinics on a prompt injury');

  const nail = await answer({ message: 'Bati a unha do dedo indicador e está dolorida desde ontem, sem outros sintomas.' });
  verify(!actualSpecialties.includes('dermatologia'), 'Model shortlist excludes Dermatologia for acute nail trauma');
  verify(nail.specialty?.id !== 'dermatologia', 'Even a wrong LLM cannot navigate nail trauma to Dermatologia');
  verify(nail.clinics.every((clinic) => clinic.specialties.includes(nail.specialty?.id)), 'Returned clinics must match validated area');

  forced = 'Ortopedia e Traumatologia';
  const nasal = await answer({ message: 'Minha esposa de 40 anos está com nariz congestionado, febre leve e indisposição desde ontem.' });
  verify(!actualSpecialties.includes('ortopedia'), 'Model shortlist excludes Ortopedia for respiratory syndrome');
  verify(nasal.specialty?.id !== 'ortopedia', 'Wrong LLM cannot navigate nose+fever to Ortopedia');
  verify(nasal.clinics.every((clinic) => clinic.specialties.includes(nasal.specialty?.id)), 'Nasal clinics match validated area');

  forced = 'Gastroenterologia';
  const bowel = await answer({ message: 'Estou com diarreia persistente há semanas, sem febre, sem outros sintomas.' });
  verify(bowel.specialty?.id === 'gastroenterologia', 'Plausible Gastroenterologia remains eligible');
  verify(bowel.clinics.every((clinic) => clinic.specialties.includes('gastroenterologia')), 'Gastro clinics match actual area');

  console.log(`APROVADO: ${checks}/${checks} verificações de fluxos clínicos com banco real em memória e IA simulada.`);
} finally { await db.close(); }
