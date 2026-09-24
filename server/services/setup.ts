import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { documentSchema } from '../../shared/contracts.js';
import type { AIProvider } from '../ai/provider.js';
import { vectorLiteral } from '../ai/provider.js';
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
  knowledgePath?: string,
) {
  if (provider.mode === 'demo')
    throw new Error('Escolha AI_PROVIDER=ollama para IA local ou openai para a API paga.');
  if (!knowledgePath && !config.ALLOW_DEMO_DATA)
    throw new Error(
      'Informe o arquivo de conhecimento aprovado: npm run setup:connected -- caminho/conhecimento.json',
    );
  const documents = z
    .array(documentSchema)
    .min(1)
    .max(1000)
    .parse(JSON.parse(await readFile(knowledgePath || 'data/knowledge.demo.json', 'utf8')));
  if (
    !config.ALLOW_DEMO_DATA &&
    documents.some((doc) => doc.isDemo || doc.reviewStatus !== 'approved')
  )
    throw new Error('Este ambiente exige conhecimento aprovado por revisor clínico.');
  await provider.checkAvailability?.();
  let indexed = 0;
  for (const document of documents) {
    if (!knowledgePath) {
      const { rows } = await db.query(
        "SELECT id FROM documents WHERE id=$1 AND data->>'isDemo'='false'",
        [document.id],
      );
      if (rows.length) continue;
    }
    if (await ingestDocument(db, provider, document)) indexed++;
  }
  const catalog = await loadPublicCatalog(db);
  return {
    indexed,
    publicClinics: catalog.imported,
    knowledgeRequiresClinicalReview: documents.some((doc) => doc.reviewStatus !== 'approved'),
  };
}

export async function checkSetup(
  db: Database,
  config: Config,
  provider: AIProvider,
  online = false,
) {
  const status = await catalogStatus(db, config, provider);
  const checks: { name: string; ok: boolean; required: boolean; message: string }[] = [
    {
      name: 'database',
      ok: true,
      required: true,
      message: 'Banco conectado e migrações aplicadas.',
    },
    {
      name: 'ai',
      required: true,
      ok: provider.mode !== 'demo',
      message:
        provider.mode === 'openai'
          ? 'OpenAI configurada; a configuração local não confirma a conexão.'
          : provider.mode === 'ollama'
            ? 'Ollama local configurado; execute o teste de integração para confirmar os modelos.'
            : 'Modo demonstrativo, sem geração por IA.',
    },
    {
      name: 'rag',
      required: true,
      ok: status.knowledge.indexedDocuments > 0 && !status.knowledge.needsReindex,
      message:
        `${status.knowledge.indexedDocuments} documentos indexados. ${status.knowledge.needsReindex ? 'Execute npm run rag:reindex.' : ''}`.trim(),
    },
    {
      name: 'clinical-review',
      required: config.NODE_ENV === 'production',
      ok: status.knowledge.demoDocuments === 0 && status.knowledge.indexedDocuments > 0,
      message:
        status.knowledge.demoDocuments > 0
          ? 'Base de homologação sem revisão clínica local.'
          : 'Consulte os metadados de revisão dos documentos importados.',
    },
    {
      name: 'catalog',
      required: true,
      ok: status.directory.total > 0 && !status.demoData,
      message: `${status.directory.total} registros visíveis. ${status.demoData ? 'Inclui dados fictícios.' : 'Sem clínicas fictícias visíveis.'}`,
    },
  ];
  if (online) {
    if (provider.mode !== 'demo') {
      // Synthetic input only: validates embeddings AND generation without sending patient data.
      try {
        const [embedding] = await provider.embed(['Teste técnico de conexão do MedFinder.']);
        vectorLiteral(embedding, provider.embeddingDimensions);
        await provider.generate({
          message:
            'Este é um teste técnico sem sintomas. Informe que faltam dados para orientação.',
          history: [],
          evidence: [],
        });
        checks.push({
          name: `${provider.mode}-live`,
          required: true,
          ok: true,
          message:
            provider.mode === 'ollama'
              ? 'Embeddings e geração responderam no Ollama local, sem chave ou API paga.'
              : 'Embeddings e Responses API responderam ao teste sintético.',
        });
      } catch (error) {
        checks.push({
          name: `${provider.mode}-live`,
          required: true,
          ok: false,
          message:
            provider.mode === 'ollama'
              ? error instanceof OllamaError
                ? error.message
                : 'Resposta local inválida. Confira os modelos e execute novamente o teste.'
              : 'Falha no teste de IA. Confira chave, acesso aos modelos, saldo, limites e conexão.',
        });
      }
    }
  }
  return {
    checks,
    allPassed: checks.filter((check) => check.required).every((check) => check.ok),
    clinicalReviewComplete: checks.find((check) => check.name === 'clinical-review')!.ok,
    liveVerified:
      online && checks.some((check) => check.name === `${provider.mode}-live` && check.ok),
  };
}
