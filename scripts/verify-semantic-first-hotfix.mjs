/** Checks model-first behavior in ambiguous clinical complaints with a fake LLM. */
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
try {
  await migrate(db);
  await loadPublicCatalog(db);
  let called = 0;
  let unavailable = false;
  const provider = {
    ...demoProvider,
    mode: 'ollama',
    generate: async () => {
      called++;
      if (unavailable) throw new Error('Simulated Ollama unavailable');
      return { urgency: 'uncertain', specialty: null, questions: ['onset_duration', 'associated_symptoms'] };
    },
  };
  const chat = new ChatService(
    new Retriever(db, provider, false), provider,
    new CatalogRepository(db, false),
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
  const ask = (message, extra = {}) => chat.answer(chatRequestSchema.parse({message, ...extra}));
  const first = await ask('Bom dia, estou com dor na pelve. O que fazer?');
  assert.equal(called, 1, 'must consult semantic model for first pelvic complaint');
  assert.equal(first.status, 'needs_information');
  assert.equal(first.mode, 'ollama');
  assert.equal(first.specialty, null);
  assert.ok(first.questions.length > 0);
  assert.ok(!first.questions.join(' ').includes('Em qual parte do corpo'));
  const second = await ask('Na pelve, próximo à virilha.', {
    history: ['Bom dia, estou com dor na pelve. O que fazer?'], context: first.context,
  });
  assert.equal(called, 2, 'must consult semantic model at clarifying turn');
  assert.equal(second.status, 'needs_information');
  assert.equal(second.specialty, null);
  unavailable = true;
  const third = await ask('Estou com dor na virilha');
  assert.equal(called, 3, 'must attempt Ollama before falling back');
  assert.equal(third.status, 'llm_unavailable');
  assert.equal(third.specialty, null);
  assert.deepEqual(third.clinics, []);
  console.log('Semantic-first hotfix: 13 assertions passed (fake LLM).');
} finally {
  await db.close();
}
