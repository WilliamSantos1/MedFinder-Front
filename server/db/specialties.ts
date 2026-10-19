import { z } from 'zod';
import { specialtyImportSchema, type Specialty } from '../../shared/contracts.js';
import type { Database } from './database.js';
import { normalize } from '../domain/text.js';

interface Entry extends Specialty {
  normalized_name: string;
  aliases: string[];
  active?: boolean;
}
export class SpecialtyRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<Specialty[]> {
    return (
      await this.db.query<Specialty>(
        'SELECT id,name FROM specialties WHERE active ORDER BY name,id',
      )
    ).rows;
  }

  async byId(id: string): Promise<Specialty | null> {
    return (
      (
        await this.db.query<Specialty>('SELECT id,name FROM specialties WHERE id=$1 AND active', [
          id,
        ])
      ).rows[0] ?? null
    );
  }

  async mentions(text: string, active = true): Promise<Specialty[]> {
    const sentence = ` ${normalize(text).replace(/[^a-z0-9]+/g, ' ')} `;
    const entries = (
      await this.db.query<Entry>(
        'SELECT id,name,normalized_name,aliases FROM specialties WHERE active=$1',
        [active],
      )
    ).rows;
    return entries
      .filter((entry) =>
        [entry.normalized_name, ...entry.aliases].some((term) =>
          sentence.includes(` ${term.replace(/[^a-z0-9]+/g, ' ')} `),
        ),
      )
      .map(({ id, name }) => ({ id, name }));
  }

  async resolve(name: string): Promise<{
    status: 'resolved' | 'not_registered' | 'unrecognized';
    specialty: Specialty | null;
  }> {
    const key = normalize(name);
    const { rows } = await this.db.query<Entry>(
      `SELECT id,name,active,normalized_name,aliases FROM specialties WHERE normalized_name=$1 OR $1=ANY(aliases)`,
      [key],
    );
    if (rows.length === 1 && rows[0].active)
      return { status: 'resolved', specialty: { id: rows[0].id, name: rows[0].name } };
    const known = await this.db.query<Specialty>(
      'SELECT id,name FROM specialty_reference WHERE normalized_name=$1 OR $1=ANY(aliases)',
      [key],
    );
    if (rows.length === 1 || known.rows.length === 1) {
      const entry = rows[0] ?? known.rows[0];
      return { status: 'not_registered', specialty: { id: entry.id, name: entry.name } };
    }
    return { status: 'unrecognized', specialty: null };
  }

  // Operator-only CLI operation. Catalog imports never call this.
  async import(raw: unknown) {
    const entries = z.array(specialtyImportSchema).min(1).max(1000).parse(raw);
    if (new Set(entries.map((e) => e.id)).size !== entries.length)
      throw new Error('Especialidades duplicadas.');
    await this.db.transaction(async (tx) => {
      await tx.exec('LOCK TABLE specialties, specialty_reference IN EXCLUSIVE MODE');
      const existing = (await tx.query<Entry>('SELECT * FROM specialty_reference')).rows;
      const next = new Map(existing.map((e) => [e.id, e]));
      for (const e of entries)
        next.set(e.id, {
          ...e,
          normalized_name: normalize(e.name),
          aliases: [...new Set(e.aliases.map(normalize))],
        });
      const terms = new Map<string, string>();
      for (const e of next.values())
        for (const term of [e.normalized_name, ...e.aliases]) {
          if (terms.has(term) && terms.get(term) !== e.id)
            throw new Error('Nome ou alias pertence a outra especialidade.');
          terms.set(term, e.id);
        }
      for (const e of entries) {
        const values = [e.id, e.name, normalize(e.name), [...new Set(e.aliases.map(normalize))]];
        await tx.query(
          `INSERT INTO specialties(id,name,normalized_name,aliases,active) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(id) DO UPDATE SET name=$2,normalized_name=$3,aliases=$4,active=$5,updated_at=now()`,
          [...values, e.active],
        );
        await tx.query(
          `INSERT INTO specialty_reference(id,name,normalized_name,aliases) VALUES($1,$2,$3,$4)
          ON CONFLICT(id) DO UPDATE SET name=$2,normalized_name=$3,aliases=$4`,
          values,
        );
      }
    });
    return entries.length;
  }
}
