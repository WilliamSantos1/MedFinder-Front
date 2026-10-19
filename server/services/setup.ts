import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { clinicDocumentSchema } from '../../shared/contracts.js';
import type { AIProvider } from '../ai/provider.js';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { ingestDocument } from '../rag/ingest.js';
import { catalogStatus } from './readiness.js';
import { loadPublicCatalog } from './public-catalog.js';
import { OllamaError } from '../ai/ollama.js';

export async function setupConnected(
  db: Database,
  config: Config,
  provider: AIProvider,
  documentPath?: string,
) {
  if (provider.mode === 'demo')
    throw new Error('Escolha AI_PROVIDER=ollama para IA local ou openai para a API paga.');
  const documents = z
    .array(clinicDocumentSchema)
    .max(1000)
    .parse(JSON.parse(await readFile(documentPath ?? 'data/clinic-documents.public.json', 'utf8')));
  if (!config.ALLOW_DEMO_DATA && documents.some((doc) => doc.isDemo))
    throw new Error('Este ambiente não aceita documentos fictícios.');
  await provider.checkAvailability?.();
  const catalog = await loadPublicCatalog(db);
  let indexed = 0;
  let ragAvailable = true;
  try {
    for (const document of documents)
      if (await ingestDocument(db, provider, document, { preserveNewer: !documentPath })) indexed++;
  } catch (error) {
    if (documentPath) throw error;
    ragAvailable = false;
  }
  return {
    indexed,
    publicClinics: catalog.imported,
    clinicRagOptional: true,
    ragAvailable,
    ...(!ragAvailable
      ? {
          notice:
            'A geração e o catálogo estão preparados; a indexação textual falhou. Confira o modelo de embeddings e repita setup:connected ou setup:ollama.',
        }
      : {}),
  };
}

export async function checkSetup(
  db: Database,
  config: Config,
  provider: AIProvider,
  online = false,
) {
  const status = await catalogStatus(db, config, provider);
  const checks = [
    {
      name: 'database',
      ok: true,
      required: true,
      message: 'Banco conectado e migrações aplicadas.',
    },
    {
      name: 'ai',
      ok: provider.mode !== 'demo',
      required: true,
      message:
        provider.mode === 'demo'
          ? 'Modo demonstrativo, sem geração por IA.'
          : 'IA configurada; o teste online confirma a geração.',
    },
    {
      name: 'clinic-rag',
      ok: status.knowledge.indexedDocuments > 0 && !status.knowledge.needsReindex,
      required: false,
      message: `${status.knowledge.indexedDocuments} documentos de clínicas indexados. O RAG é opcional; não escolhe especialidades.`,
    },
    {
      name: 'catalog',
      ok: status.directory.total > 0 && !status.demoData,
      required: true,
      message: `${status.directory.total} registros visíveis. Confirme as fontes e datas dos cadastros.`,
    },
  ];
  if (online && provider.mode !== 'demo') {
    try {
      await provider.checkAvailability?.();
      await provider.generate({
        message: 'Teste técnico sem sintomas. Informe que faltam dados para orientação.',
        history: [],
      });
      checks.push({
        name: `${provider.mode}-live`,
        ok: true,
        required: true,
        message: 'Geração respondeu ao teste sintético.',
      });
    } catch (error) {
      checks.push({
        name: `${provider.mode}-live`,
        ok: false,
        required: true,
        message:
          provider.mode === 'ollama' && error instanceof OllamaError
            ? error.message
            : 'Falha no teste de geração. Confira a configuração, modelos e conexão.',
      });
    }
    if (status.knowledge.indexedDocuments > 0) {
      try {
        await provider.embed(['Teste técnico do índice textual de clínicas.']);
        checks.push({
          name: 'embeddings-live',
          ok: true,
          required: false,
          message: 'Embeddings responderam ao teste sintético.',
        });
      } catch {
        checks.push({
          name: 'embeddings-live',
          ok: false,
          required: false,
          message: 'RAG de clínicas indisponível; geração e catálogo são independentes.',
        });
      }
    }
  }
  return {
    checks,
    allPassed: checks.filter((check) => check.required).every((check) => check.ok),
    liveVerified:
      online && checks.some((check) => check.name === `${provider.mode}-live` && check.ok),
  };
}
