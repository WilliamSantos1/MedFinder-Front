import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { clinicSchema, documentSchema } from '../../shared/contracts.js';
import type { AIProvider } from '../ai/provider.js';
import { ingestDocument } from '../rag/ingest.js';
import { CatalogRepository } from './catalog.js';
import type { Database } from './database.js';
import { loadPublicCatalog } from '../services/public-catalog.js';

export async function seedDevelopment(db: Database, provider: AIProvider) {
  await loadPublicCatalog(db);
  const documents = z
    .array(documentSchema)
    .parse(JSON.parse(await readFile(resolve('data/knowledge.demo.json'), 'utf8')));
  for (const document of documents) {
    // A local startup must never replace documents already approved by an operator.
    const { rows } = await db.query(
      "SELECT id FROM documents WHERE id=$1 AND data->>'isDemo'='false'",
      [document.id],
    );
    if (!rows.length) await ingestDocument(db, provider, document);
  }
}

export async function seedDemo(db: Database, provider: AIProvider) {
  const clinics = z
    .array(clinicSchema)
    .parse(JSON.parse(await readFile(resolve('data/clinics.demo.json'), 'utf8')));
  const documents = z
    .array(documentSchema)
    .parse(JSON.parse(await readFile(resolve('data/knowledge.demo.json'), 'utf8')));
  await new CatalogRepository(db, true).import(clinics);
  for (const document of documents) await ingestDocument(db, provider, document);
}
