import { describe, expect, it } from 'vitest';
import { connectDatabase } from '../server/db/database.js';
import { readConfig } from '../server/config.js';
import { migrate } from '../server/db/migrations.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { clinic } from './fixtures.js';
import { SpecialtyRepository } from '../server/db/specialties.js';

// Minimal installed v1.3 schema fixture. Upgrade must preserve rows, not recreate the database.
const legacySchema = `
CREATE EXTENSION vector;
CREATE TABLE schema_migrations(version integer PRIMARY KEY,applied_at timestamptz DEFAULT now());
INSERT INTO schema_migrations(version) VALUES(1),(2),(3),(4);
CREATE TABLE clinics(id text PRIMARY KEY,city_key text NOT NULL,insurance_keys text[] NOT NULL,specialty_ids text[] NOT NULL,data jsonb NOT NULL);
CREATE TABLE documents(id text PRIMARY KEY,content_hash text NOT NULL,embedding_model text NOT NULL,data jsonb NOT NULL);
CREATE TABLE chunks(id text PRIMARY KEY,document_id text REFERENCES documents(id),content text,search_text text,embedding vector);
CREATE TABLE catalog_collections(id text PRIMARY KEY,clinic_ids text[] NOT NULL,imported_at timestamptz DEFAULT now());
CREATE TABLE integration_state(provider text PRIMARY KEY,status text,last_attempt_at timestamptz,last_success_at timestamptz,summary jsonb);
`;
describe('Upgrade de instalação existente', () => {
  it('migração 10 habilita Pediatria sem reativar Medicina de Família ou registros desativados pelo operador', async () => {
    const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
    try {
      await migrate(db);
      await db.exec(
        "DELETE FROM schema_migrations WHERE version=10; DELETE FROM specialties WHERE id='pediatria'",
      );
      const specialties = new SpecialtyRepository(db);
      expect((await specialties.resolve('Pediatra')).status).toBe('not_registered');
      await migrate(db);
      expect((await specialties.resolve('Pediatra')).status).toBe('resolved');
      expect((await specialties.resolve('Médico de família')).status).toBe('not_registered');
      await db.exec(
        "DELETE FROM schema_migrations WHERE version=10; UPDATE specialties SET active=false WHERE id='pediatria'",
      );
      await migrate(db);
      await migrate(db);
      expect((await specialties.resolve('Pediatra')).status).toBe('not_registered');
    } finally {
      await db.close();
    }
  });
  it('migração 9 desativa Medicina de Família sem apagar a unidade nem as relações existentes', async () => {
    const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
    try {
      await migrate(db);
      await db.exec(
        "DELETE FROM schema_migrations WHERE version=9; UPDATE specialties SET active=true WHERE id='medicina-de-familia'",
      );
      const catalog = new CatalogRepository(db, true);
      await catalog.import([
        clinic({ id: 'demo-before-nine', specialties: ['medicina-de-familia', 'ortopedia'] }),
      ]);
      await migrate(db);
      await migrate(db);
      expect((await new SpecialtyRepository(db).resolve('Médico de família')).status).toBe(
        'not_registered',
      );
      expect((await db.query('SELECT * FROM clinic_specialties')).rows).toHaveLength(2);
      const result = await catalog.search({
        city: '',
        insurance: '',
        specialty: 'ortopedia',
        page: 1,
      });
      expect(result.items[0].specialties).toEqual(['ortopedia']);
      expect(
        (
          await catalog.search({
            city: '',
            insurance: '',
            specialty: 'medicina-de-familia',
            page: 1,
          })
        ).total,
      ).toBe(0);
    } finally {
      await db.close();
    }
  });
  it('migra relações, preserva fontes médicas legadas e é idempotente', async () => {
    const db = await connectDatabase(readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' }));
    try {
      await db.exec(legacySchema);
      const previous = clinic({ id: 'demo-existing', specialties: ['ortopedia'] });
      await db.query('INSERT INTO clinics VALUES($1,$2,$3,$4,$5::jsonb)', [
        previous.id,
        'fortaleza',
        ['plano exemplo a'],
        ['ortopedia'],
        JSON.stringify(previous),
      ]);
      await db.query("INSERT INTO documents VALUES('legacy-doc','hash','old-model','{}'::jsonb)");
      await migrate(db);
      await migrate(db);
      expect((await db.query('SELECT * FROM clinic_specialties')).rows).toEqual([
        { clinic_id: previous.id, specialty_id: 'ortopedia' },
      ]);
      expect((await db.query('SELECT id FROM legacy_medical_documents')).rows).toEqual([
        { id: 'legacy-doc' },
      ]);
      expect((await db.query('SELECT id FROM clinic_documents')).rows).toEqual([]);
      expect(
        (await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows,
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((version) => ({ version })));
      const result = await new CatalogRepository(db, true).search({
        city: 'Fortaleza',
        insurance: 'Plano Exemplo A',
        specialty: 'ortopedia',
        page: 1,
      });
      expect(result.items[0]).toMatchObject({
        id: previous.id,
        distanceKm: null,
        latitude: null,
        longitude: null,
      });
    } finally {
      await db.close();
    }
  });
});
