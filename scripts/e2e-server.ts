import { readConfig } from '../server/config.js';
import { connectDatabase } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { seedDevelopment } from '../server/db/seed.js';
import { demoProvider } from '../server/ai/demo.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { clinicSchema } from '../shared/contracts.js';
import { buildApp } from '../server/app.js';

const config = readConfig();
if (
  config.NODE_ENV !== 'test' ||
  config.DATA_DIR !== 'memory://' ||
  config.DATABASE_URL ||
  config.AI_PROVIDER !== 'demo'
)
  throw new Error('Fixtures E2E exigem ambiente de teste, IA demo e banco somente em memória.');
const db = await connectDatabase(config);
await migrate(db);
await seedDevelopment(db, demoProvider);
await new CatalogRepository(db, true).import(
  [0, 1].map((index) =>
    clinicSchema.parse({
      id: `e2e-urologia-${index}`,
      name: `Unidade fictícia de urologia ${index + 1}`,
      city: 'Cidade de teste',
      state: 'CE',
      neighborhood: null,
      address: 'Endereço fictício, sem atendimento',
      specialties: ['urologia'],
      insurances: ['Plano de teste'],
      phone: null,
      website: null,
      sourceUrl: null,
      verifiedAt: null,
      latitude: -3.732 + index * 0.02,
      longitude: -38.527,
      isDemo: true,
      active: true,
    }),
  ),
);
const app = await buildApp(config, db, demoProvider);
app.addHook('onClose', () => db.close());
await app.listen({ port: config.PORT, host: config.HOST });
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void app.close();
  });
