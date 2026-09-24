import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { clinicSchema } from '../../shared/contracts.js';
import { CatalogRepository } from '../db/catalog.js';
import type { Database } from '../db/database.js';

export const publicCatalogSchema = z
  .array(clinicSchema)
  .min(1)
  .max(10000)
  .superRefine((clinics, ctx) => {
    if (new Set(clinics.map((clinic) => clinic.id)).size !== clinics.length)
      ctx.addIssue({ code: 'custom', message: 'IDs duplicados no catálogo público.' });
    if (clinics.some((clinic) => clinic.isDemo || !clinic.id.startsWith('public-')))
      ctx.addIssue({
        code: 'custom',
        message: 'A coleção pública exige dados reais e IDs public-.',
      });
  });

export async function readPublicCatalog(path = 'data/clinics.public.json') {
  return publicCatalogSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

/** Load a versioned local snapshot. This never crawls websites or renews verification dates. */
export async function loadPublicCatalog(db: Database, path?: string) {
  const clinics = await readPublicCatalog(path);
  const ids = clinics.map((clinic) => clinic.id);
  await db.transaction(async (tx) => {
    // Serialize this small maintenance operation, including the first import.
    await tx.exec('LOCK TABLE catalog_collections IN EXCLUSIVE MODE');
    const previous = await tx.query<{ clinic_ids: string[] }>(
      "SELECT clinic_ids FROM catalog_collections WHERE id='bundled-public'",
    );
    const managedIds = previous.rows[0]?.clinic_ids ?? [
      'public-fortaleza-santa-luzia',
      'public-fortaleza-carlos-ribeiro',
    ];
    await tx.query(
      `UPDATE clinics SET data=jsonb_set(data,'{active}','false'::jsonb)
        WHERE (id=ANY($1::text[]) AND NOT id=ANY($2::text[])) OR (data->>'isDemo')::boolean`,
      [managedIds, ids],
    );
    await CatalogRepository.write(tx, clinics);
    await tx.query(
      `INSERT INTO catalog_collections(id,clinic_ids) VALUES('bundled-public',$1)
       ON CONFLICT(id) DO UPDATE SET clinic_ids=$1,imported_at=now()`,
      [ids],
    );
  });
  return { imported: clinics.length, cities: [...new Set(clinics.map((c) => c.city))].sort() };
}
