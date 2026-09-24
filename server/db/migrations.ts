import type { Database } from './database.js';

const migrations = [
  {
    version: 1,
    sql: `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE TABLE clinics (
    id text PRIMARY KEY,
    city_key text NOT NULL,
    insurance_keys text[] NOT NULL,
    specialty_ids text[] NOT NULL,
    data jsonb NOT NULL
  );
  CREATE INDEX clinics_city_idx ON clinics(city_key);
  CREATE INDEX clinics_specialty_idx ON clinics USING gin(specialty_ids);
  CREATE TABLE documents (
    id text PRIMARY KEY,
    content_hash text NOT NULL,
    embedding_model text NOT NULL,
    data jsonb NOT NULL
  );
  CREATE TABLE chunks (
    id text PRIMARY KEY,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content text NOT NULL,
    search_text text NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', search_text)) STORED,
    embedding vector(1536) NOT NULL
  );
  CREATE INDEX chunks_search_idx ON chunks USING gin(search_vector);
  CREATE INDEX chunks_document_idx ON chunks(document_id);
`,
  },
  {
    version: 2,
    sql: `CREATE TABLE integration_state (
      provider text PRIMARY KEY,
      status text NOT NULL,
      last_attempt_at timestamptz NOT NULL,
      last_success_at timestamptz,
      summary jsonb NOT NULL DEFAULT '{}'::jsonb
    );`,
  },
  {
    version: 3,
    // Preserve old records for audit, but never serve a disconnected API snapshot.
    sql: `UPDATE clinics SET data=jsonb_set(data,'{active}','false'::jsonb)
      WHERE data->>'provenance'='docplanner';
      CREATE TABLE catalog_collections (
        id text PRIMARY KEY,
        clinic_ids text[] NOT NULL,
        imported_at timestamptz NOT NULL DEFAULT now()
      );`,
  },
  {
    version: 4,
    // Preserve existing 1536-dimensional vectors while supporting local models.
    // Retrieval materializes the matching model before comparing dimensions.
    sql: 'ALTER TABLE chunks ALTER COLUMN embedding TYPE vector USING embedding::vector;',
  },
];

export async function migrate(db: Database) {
  // Only an operator runs migrations in production; one startup process locally.
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const migration of migrations) {
    await db.transaction(async (tx) => {
      await tx.exec('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
      const { rows } = await tx.query('SELECT version FROM schema_migrations WHERE version=$1', [
        migration.version,
      ]);
      if (rows.length) return;
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations(version) VALUES ($1)', [migration.version]);
    });
  }
}
