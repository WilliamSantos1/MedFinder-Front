import { buildApp } from './app.js';
import { createProvider } from './ai/factory.js';
import { readConfig } from './config.js';
import { connectDatabase } from './db/database.js';
import { migrate } from './db/migrations.js';
import { seedDevelopment } from './db/seed.js';

async function main() {
  const config = readConfig();
  const db = await connectDatabase(config);
  try {
    if (config.NODE_ENV !== 'production') await migrate(db);
    const provider = createProvider(config);
    if (config.AUTO_SEED && config.ALLOW_DEMO_DATA) {
      await seedDevelopment(db, provider);
    }
    const app = await buildApp(config, db, provider);
    app.addHook('onClose', async () => {
      await db.close();
    });
    await app.listen({ port: config.PORT, host: config.HOST });
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        void app.close().catch(() => {
          process.exitCode = 1;
        });
      });
  } catch (error) {
    await db.close();
    throw error;
  }
}

main().catch(() => {
  console.error(
    'Não foi possível iniciar o MedFinder. Verifique o .env, a conexão e as migrações.',
  );
  process.exitCode = 1;
});
