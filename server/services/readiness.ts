import type { AIProvider } from '../ai/provider.js';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { CatalogRepository } from '../db/catalog.js';

export async function catalogStatus(db: Database, config: Config, provider: AIProvider) {
  const catalog = await new CatalogRepository(db, config.ALLOW_DEMO_DATA).metadata();
  const { rows } = await db.query<{ indexed: string; demo: string; outdated: string }>(
    `
    SELECT count(*) FILTER (WHERE embedding_model=$1) AS indexed,
      count(*) FILTER (WHERE embedding_model=$1 AND (data->>'isDemo')::boolean) AS demo,
      count(*) FILTER (WHERE embedding_model<>$1) AS outdated
    FROM documents WHERE (data->>'active')::boolean AND
      (($2::boolean AND (data->>'isDemo')::boolean) OR
        ((data->>'isDemo')::boolean=false AND data->>'reviewStatus'='approved'
          AND (data->>'reviewedAt')::timestamptz >= now()-interval '365 days'))`,
    [provider.embeddingModel, config.ALLOW_DEMO_DATA],
  );
  const { total, realRecords, sourceCount, lastVerifiedAt, ...metadata } = catalog;
  return {
    ...metadata,
    mode: provider.mode,
    chatTimeoutMs: provider.mode === 'ollama' ? 2 * config.OLLAMA_TIMEOUT_MS + 30000 : 60000,
    requiresConsent: provider.mode === 'openai',
    knowledge: {
      indexedDocuments: Number(rows[0].indexed),
      demoDocuments: Number(rows[0].demo),
      needsReindex: Number(rows[0].outdated) > 0,
    },
    directory: {
      total,
      realRecords,
      sourceCount,
      lastVerifiedAt,
    },
  };
}
