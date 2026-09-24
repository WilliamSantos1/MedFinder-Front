import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Config } from '../config.js';

export interface SqlClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}
export interface Database extends SqlClient {
  transaction<T>(run: (tx: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function connectDatabase(config: Config): Promise<Database> {
  if (!config.DATABASE_URL) {
    if (config.DATA_DIR !== 'memory://')
      await mkdir(dirname(resolve(config.DATA_DIR)), { recursive: true });
    const db = new PGlite(config.DATA_DIR, { extensions: { vector } });
    await db.waitReady;
    return {
      query: (sql, params) => db.query(sql, params),
      exec: async (sql) => {
        await db.exec(sql);
      },
      transaction: (run) =>
        db.transaction((tx) =>
          run({
            query: (sql, params) => tx.query(sql, params),
            exec: async (sql) => {
              await tx.exec(sql);
            },
          }),
        ),
      close: () => db.close(),
    };
  }
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
  await pool.query('SELECT 1');
  return {
    query: async <T>(sql: string, params?: unknown[]) => ({
      rows: (await pool.query(sql, params)).rows as T[],
    }),
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (run) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const value = await run({
          query: async <T>(sql: string, params?: unknown[]) => ({
            rows: (await client.query(sql, params)).rows as T[],
          }),
          exec: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
