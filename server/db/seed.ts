import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { clinicSchema, clinicDocumentSchema } from '../../shared/contracts.js';
import type { AIProvider } from '../ai/provider.js';
import { ingestDocument } from '../rag/ingest.js';
import { CatalogRepository } from './catalog.js';
import type { Database } from './database.js';
import { loadPublicCatalog } from '../services/public-catalog.js';

export async function seedDevelopment(db: Database, provider?: AIProvider) {
  await loadPublicCatalog(db);
  // Offline demo indexing only. Generative providers are prepared explicitly by the operator.
  if (provider?.mode === 'demo') {
    const documents = z
      .array(clinicDocumentSchema)
      .parse(JSON.parse(await readFile('data/clinic-documents.public.json', 'utf8')));
    for (const document of documents)
      await ingestDocument(db, provider, document, { preserveNewer: true });
  }
}

export async function seedDemo(db: Database, provider: AIProvider) {
  const clinics = z
    .array(clinicSchema)
    .parse(JSON.parse(await readFile('data/clinics.demo.json', 'utf8')));
  const documents = z
    .array(clinicDocumentSchema)
    .parse(JSON.parse(await readFile('data/clinic-documents.demo.json', 'utf8')));
  await new CatalogRepository(db, true).import(clinics);
  for (const document of documents) await ingestDocument(db, provider, document);
}
