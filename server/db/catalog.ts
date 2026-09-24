import {
  clinicSchema,
  specialties,
  type Clinic,
  type ClinicFilters,
  type ClinicResults,
  type Specialty,
} from '../../shared/contracts.js';
import { normalize } from '../domain/text.js';
import type { Database, SqlClient } from './database.js';

export class CatalogRepository {
  constructor(
    private readonly db: Database,
    private readonly allowDemo: boolean,
  ) {}

  async import(clinics: Clinic[]) {
    const validated = clinics.map((clinic) => clinicSchema.parse(clinic));
    if (new Set(validated.map((clinic) => clinic.id)).size !== validated.length)
      throw new Error('O catálogo contém IDs duplicados.');
    await this.db.transaction((tx) => CatalogRepository.write(tx, validated));
  }

  static async write(tx: SqlClient, validated: Clinic[]) {
    for (const clinic of validated) {
      await tx.query(
        `INSERT INTO clinics(id,city_key,insurance_keys,specialty_ids,data) VALUES($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT(id) DO UPDATE SET city_key=$2,insurance_keys=$3,specialty_ids=$4,data=$5::jsonb`,
        [
          clinic.id,
          normalize(clinic.city),
          clinic.insurances.map(normalize),
          clinic.specialties,
          JSON.stringify(clinic),
        ],
      );
    }
  }

  private visibility = `(data->>'active')::boolean = true AND
    (($1::boolean AND (data->>'isDemo')::boolean) OR
      ((data->>'isDemo')::boolean = false AND (data->>'verifiedAt')::timestamptz >= now() -
        interval '180 days' AND (data->>'verifiedAt')::timestamptz <= now()))`;

  async search(filters: ClinicFilters, specialtyIds?: Specialty[]): Promise<ClinicResults> {
    const ids = specialtyIds ?? (filters.specialty ? [filters.specialty] : []);
    const where = `${this.visibility}
      AND ($2='' OR city_key=$2) AND ($3='' OR $3=ANY(insurance_keys))
      AND (cardinality($4::text[])=0 OR specialty_ids && $4::text[])
      AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) AS term
        WHERE strpos(translate(lower(concat_ws(' ',data->>'name',data->>'neighborhood',data->>'address')),
          'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),term)=0)`;
    const params = [
      this.allowDemo,
      normalize(filters.city),
      normalize(filters.insurance),
      ids,
      normalize(filters.q ?? '')
        .split(/\s+/)
        .filter(Boolean),
    ];
    const count = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total FROM clinics WHERE ${where}`,
      params,
    );
    const { rows } = await this.db.query<{ data: Clinic }>(
      `SELECT data FROM clinics WHERE ${where}
      ORDER BY (data->>'isDemo')::boolean, data->>'name',id LIMIT 6 OFFSET $6`,
      [...params, (filters.page - 1) * 6],
    );
    return {
      items: rows.map((row) => row.data),
      total: Number(count.rows[0].total),
      page: filters.page,
      pageSize: 6,
    };
  }

  async metadata() {
    const { rows } = await this.db.query<{ data: Clinic }>(
      `SELECT data FROM clinics WHERE ${this.visibility}`,
      [this.allowDemo],
    );
    return {
      cities: [...new Set(rows.map(({ data }) => data.city))].sort(),
      insurances: [...new Set(rows.flatMap(({ data }) => data.insurances))].sort(),
      specialties,
      demoData: rows.some(({ data }) => data.isDemo),
      total: rows.length,
      realRecords: rows.filter(({ data }) => !data.isDemo).length,
      sourceCount: new Set(
        rows
          .filter(({ data }) => !data.isDemo && data.sourceUrl)
          .map(({ data }) => new URL(data.sourceUrl!).hostname.replace(/^www\./, '')),
      ).size,
      lastVerifiedAt:
        rows
          .filter(({ data }) => !data.isDemo && data.verifiedAt)
          .map(({ data }) => data.verifiedAt!)
          .sort()
          .at(-1) ?? null,
    };
  }
}
