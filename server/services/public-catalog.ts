import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { clinicSchema, type Clinic } from '../../shared/contracts.js';
import { normalize } from '../domain/text.js';
import { CatalogRepository } from '../db/catalog.js';
import type { Database } from '../db/database.js';

export const publicCatalogSchema = z
  .array(clinicSchema)
  .min(1)
  .max(10000)
  .superRefine((clinics, ctx) => {
    if (new Set(clinics.map((clinic) => clinic.id)).size !== clinics.length)
      ctx.addIssue({ code: 'custom', message: 'IDs duplicados no catálogo público.' });
    const units = clinics.map((clinic) =>
      normalize(`${clinic.city}|${clinic.address}|${clinic.name}`),
    );
    if (new Set(units).size !== units.length)
      ctx.addIssue({ code: 'custom', message: 'Unidades duplicadas no catálogo público.' });
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
    const existing = await tx.query<{ id: string; data: Clinic }>(
      'SELECT id,data FROM clinics WHERE id=ANY($1::text[]) FOR UPDATE',
      [ids],
    );
    const previousData = new Map(existing.rows.map((row) => [row.id, row.data]));
    const merged = clinics.map((clinic) => {
      const previous = previousData.get(clinic.id);
      // Preserve a newer operator verification; loading an older bundle must not roll it back.
      return previous?.latitude != null &&
        previous.longitude != null &&
        previous.coordinatesVerifiedAt &&
        previous.coordinatesSourceUrl &&
        (clinic.latitude === null ||
          Date.parse(previous.coordinatesVerifiedAt) >
            Date.parse(clinic.coordinatesVerifiedAt ?? ''))
        ? {
            ...clinic,
            latitude: previous.latitude,
            longitude: previous.longitude,
            coordinatesVerifiedAt: previous.coordinatesVerifiedAt,
            coordinatesSourceUrl: previous.coordinatesSourceUrl,
          }
        : clinic;
    });
    await CatalogRepository.write(tx, merged);
    await tx.query(
      `INSERT INTO catalog_collections(id,clinic_ids) VALUES('bundled-public',$1)
       ON CONFLICT(id) DO UPDATE SET clinic_ids=$1,imported_at=now()`,
      [ids],
    );
  });
  return { imported: clinics.length, cities: [...new Set(clinics.map((c) => c.city))].sort() };
}
