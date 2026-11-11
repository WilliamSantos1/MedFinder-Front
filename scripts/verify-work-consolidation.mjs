/** Execute after `npm run build`: node scripts/verify-work-consolidation.mjs */
import assert from 'node:assert/strict';
import { readConfig } from '../build/server/config.js';
import { connectDatabase } from '../build/server/db/database.js';
import { migrate } from '../build/server/db/migrations.js';
import { CatalogRepository } from '../build/server/db/catalog.js';
import { SpecialtyRepository } from '../build/server/db/specialties.js';
import { demoProvider } from '../build/server/ai/demo.js';
import { Retriever } from '../build/server/rag/retrieve.js';
import { ChatService } from '../build/server/services/chat.js';
import { SpecialtyResolver } from '../build/server/services/specialty-resolver.js';
import { readPublicCatalog, loadPublicCatalog } from '../build/server/services/public-catalog.js';
import { chatRequestSchema, chatResponseSchema } from '../build/shared/contracts.js';

const idList = (items) => items.map((clinic) => clinic.id).sort();
const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
let checks = 0;
try {
  await migrate(db);
  await loadPublicCatalog(db);
  const catalog = new CatalogRepository(db, false);
  const provider = {
    ...demoProvider,
    generate: async () => { throw new Error('Catalog lookup should not call the language model'); },
    embed: async () => { throw new Error('Catalog lookup should not require embeddings'); },
  };
  const service = new ChatService(
    new Retriever(db, provider, false), provider, catalog,
    new SpecialtyResolver(new SpecialtyRepository(db)),
  );
  const chat = async (message, context) => chatResponseSchema.parse(
    await service.answer(chatRequestSchema.parse({ message, ...(context ? { context } : {}) })),
  );
  const publicClinics = await readPublicCatalog();
  const knownPlans = [...new Set(publicClinics.flatMap((clinic) => clinic.insurances))];
  const pairs = publicClinics.reduce((n, clinic) => n + clinic.insurances.length, 0);
  assert.ok(publicClinics.length >= 1 && knownPlans.length >= 1 && pairs >= 1);
  console.log(`Catalog: ${publicClinics.length} clinics, ${knownPlans.length} registered insurers, ${pairs} known clinic-plan links`);

  const original = ['public-cti', 'public-multiclinica-fortaleza', 'public-multiclinic'];
  const start = { specialtyId: 'ortopedia', clinicIds: original, city: '', insurance: '' };
  const cafaz = await chat('Quais destas clínicas atendem pelo CAFAZ?', start);
  assert.deepEqual(idList(cafaz.clinics), ['public-cti']); checks++;
  const unimed = await chat('E a Unimed?', cafaz.context);
  assert.deepEqual(idList(unimed.clinics), ['public-cti', 'public-multiclinic']); checks++;
  const empty = await chat('E pelo FUSEX?', unimed.context);
  assert.deepEqual(empty.clinics, []);
  assert.deepEqual(empty.context.catalog.selectionIds, original); checks++;
  const again = await chat('E a Unimed?', empty.context);
  assert.deepEqual(idList(again.clinics), idList(unimed.clinics)); checks++;
  const clear = await chat('Dessas clínicas, pesquise sem filtro de convênio', again.context);
  assert.deepEqual(idList(clear.clinics), [...original].sort()); checks++;
  const global = await chat('Pesquise em todas as clínicas que aceitam Unimed', clear.context);
  assert.equal(global.context.catalog.scope, 'all'); checks++;
  const relative = await chat('Quais dessas clínicas aceitam CAFAZ?', global.context);
  assert.deepEqual(relative.context.catalog.selectionIds, global.clinics.map((clinic) => clinic.id)); checks++;
  assert.ok(relative.clinics.every((clinic) => global.clinics.some((old) => old.id === clinic.id))); checks++;

  // Every insurer from the imported database works without a hard-coded rule.
  // The very same SQL filter must supply the answer to the conversational query.
  for (const plan of knownPlans) {
    const globalResult = await chat(`Quais clínicas aceitam o convênio ${plan}?`);
    const sql = await catalog.search({ city: '', insurance: plan, specialty: '', page: 1 });
    assert.deepEqual(globalResult.clinics.map((clinic) => clinic.id), sql.items.slice(0, 3).map((clinic) => clinic.id));
    checks++;
    for (let index = 0; index < publicClinics.length; index += 3) {
      const group = publicClinics.slice(index, index + 3);
      const result = await chat(`Dessas clínicas, quais aceitam o convênio ${plan}?`, {
        specialtyId: null, clinicIds: group.map((clinic) => clinic.id), city: '', insurance: '',
      });
      assert.deepEqual(idList(result.clinics), idList(group.filter((clinic) => clinic.insurances.includes(plan))));
      checks++;
    }
  }
  console.log(`PASS: ${checks} SQL/chat comparison checks; no language-model calls required for catalog filtering.`);
} finally {
  await db.close();
}
