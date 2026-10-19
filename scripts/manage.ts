import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { clinicSchema, clinicDocumentSchema, type ClinicDocument } from '../shared/contracts.js';
import { createProvider } from '../server/ai/factory.js';
import { OllamaError } from '../server/ai/ollama.js';
import { readConfig } from '../server/config.js';
import { SpecialtyRepository } from '../server/db/specialties.js';
import { FeedbackRepository } from '../server/db/feedback.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { connectDatabase } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { seedDemo, seedDevelopment } from '../server/db/seed.js';
import { ingestDocument } from '../server/rag/ingest.js';
import { checkSetup, setupConnected } from '../server/services/setup.js';
import { loadPublicCatalog } from '../server/services/public-catalog.js';

async function main() {
  const config = readConfig();
  const command = process.argv[2];
  if (
    ![
      'migrate',
      'feedback-prune',
      'seed',
      'import',
      'reindex',
      'setup-connected',
      'check',
      'check-online',
      'catalog-load',
      'setup-local',
      'setup-ollama',
    ].includes(command)
  )
    throw new Error('Comando de manutenção desconhecido. Consulte package.json.');
  if (command === 'seed' && !config.ALLOW_DEMO_DATA)
    throw new Error('Carga demonstrativa desativada neste ambiente.');
  const db = await connectDatabase(config);
  try {
    await migrate(db);
    if (command === 'migrate') {
      console.log('Migrações aplicadas.');
      return;
    }
    if (command === 'feedback-prune') {
      await new FeedbackRepository(db).purgeExpiredReceipts();
      console.log('Comprovantes de resposta expirados removidos.');
      return;
    }
    if (command === 'catalog-load') {
      console.log(JSON.stringify(await loadPublicCatalog(db), null, 2));
      return;
    }
    const provider = createProvider(config);
    if (command === 'setup-local') {
      if (!config.ALLOW_DEMO_DATA || provider.mode !== 'demo')
        throw new Error(
          'setup:local é demonstrativo. Para IA generativa local, use setup:ollama; para OpenAI, setup:connected.',
        );
      await seedDevelopment(db, provider);
      console.log(
        'Catálogo real carregado. O RAG de clínicas é opcional; o modo demo não usa IA generativa.',
      );
      return;
    }
    if (command === 'setup-connected' || command === 'setup-ollama') {
      if (command === 'setup-ollama' && provider.mode !== 'ollama')
        throw new Error('setup:ollama exige AI_PROVIDER=ollama no .env.');
      console.log(
        'Verificando a IA e preparando o catálogo. Documentos de clínicas são opcionais.',
      );
      console.log(
        JSON.stringify(await setupConnected(db, config, provider, process.argv[3]), null, 2),
      );
      if (command === 'setup-ollama') {
        console.log('Testando geração local com uma mensagem técnica…');
        const result = await checkSetup(db, config, provider, true);
        console.log(JSON.stringify(result, null, 2));
        if (!result.allPassed) process.exitCode = 1;
        else console.log('IA local pronta. Execute npm.cmd run dev e abra http://localhost:5173.');
      } else
        console.log(
          'Catálogo importado e RAG preparado. Execute npm run integrations:check para validar a IA.',
        );
      return;
    }
    if (command === 'check' || command === 'check-online') {
      const result = await checkSetup(db, config, provider, command === 'check-online');
      console.log(JSON.stringify(result, null, 2));
      if (!result.allPassed) process.exitCode = 1;
      return;
    }
    if (command === 'seed') {
      await seedDemo(db, provider);
      console.log('Dados fictícios e base demonstrativa carregados.');
    } else if (command === 'import') {
      const [kind, path] = process.argv.slice(3);
      if (!path || !['clinics', 'clinic-documents', 'specialties'].includes(kind))
        throw new Error(
          'Use: npm run data:import -- clinics|clinic-documents|specialties caminho.json',
        );
      const data: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (kind === 'specialties') {
        console.log(
          `${await new SpecialtyRepository(db).import(data)} especialidades cadastradas.`,
        );
      } else if (kind === 'clinics') {
        const clinics = z.array(clinicSchema).max(10000).parse(data);
        if (!config.ALLOW_DEMO_DATA && clinics.some((clinic) => clinic.isDemo))
          throw new Error('Remova os dados fictícios antes de importar.');
        await new CatalogRepository(db, config.ALLOW_DEMO_DATA).import(clinics);
        console.log(`${clinics.length} clínicas importadas.`);
      } else {
        const documents = z.array(clinicDocumentSchema).max(1000).parse(data);
        if (!config.ALLOW_DEMO_DATA && documents.some((doc) => doc.isDemo))
          throw new Error('Produção só aceita documentos reais, com fonte e data verificadas.');
        let changed = 0;
        for (const document of documents)
          if (await ingestDocument(db, provider, document)) changed++;
        console.log(`${changed} documentos atualizados. Os demais já estavam indexados.`);
      }
    } else {
      const { rows } = await db.query<{ data: ClinicDocument }>(
        `SELECT jsonb_build_object('id',id,'clinicId',clinic_id,'title',title,'content',content,
          'sourceUrl',source_url,'verifiedAt',to_char(verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'isDemo',is_demo,'active',active) AS data FROM clinic_documents ORDER BY id`,
      );
      let changed = 0;
      for (const { data } of rows)
        if (await ingestDocument(db, provider, data, { force: true })) changed++;
      console.log(`${changed} documentos reindexados para ${provider.embeddingModel}.`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  // Schema/config messages are safe; SDK/network errors may embed sensitive data.
  if (error instanceof z.ZodError)
    console.error('Arquivo inválido. Consulte os campos e limites em shared/contracts.ts.');
  else if (error instanceof OllamaError || (error instanceof Error && error.constructor === Error))
    console.error(error.message);
  else console.error('Operação interrompida. Verifique a configuração, a conexão e os dados.');
  process.exitCode = 1;
});
