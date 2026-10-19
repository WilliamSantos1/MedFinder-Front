import {
  clinicSchema,
  type Clinic,
  type ClinicFilters,
  type ClinicResults,
  type Specialty,
} from '../../shared/contracts.js';
import { normalize } from '../domain/text.js';
import { distanceKm } from '../domain/distance.js';
import type { Database, SqlClient } from './database.js';
import { SpecialtyRepository } from './specialties.js';

export class CatalogRepository {
  constructor(
    private readonly db: Database,
    private readonly allowDemo: boolean,
  ) {}

  async import(clinics: Clinic[]) {
    const validated = clinics.map((clinic) => clinicSchema.parse(clinic));
    if (new Set(validated.map((clinic) => clinic.id)).size !== validated.length)
      throw new Error('O catálogo contém IDs duplicados.');
    if (!this.allowDemo && validated.some((clinic) => clinic.isDemo))
      throw new Error('Clínicas fictícias não são permitidas neste ambiente.');
    await this.db.transaction((tx) => CatalogRepository.write(tx, validated));
  }

  static async write(tx: SqlClient, validated: Clinic[]) {
    const requested = [...new Set(validated.flatMap((c) => c.specialties))];
    const registered = await tx.query<{ id: string }>(
      'SELECT id FROM specialties WHERE active AND id=ANY($1::text[]) FOR SHARE',
      [requested],
    );
    if (requested.some((id) => !registered.rows.some((row) => row.id === id)))
      throw new Error('Cadastre e ative as especialidades antes de importar as clínicas.');
    for (const clinic of validated) {
      await tx.query(
        `INSERT INTO clinics(id,city_key,insurance_keys,data,latitude,longitude,coordinates_verified_at,coordinates_source_url)
          VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
          ON CONFLICT(id) DO UPDATE SET city_key=$2,insurance_keys=$3,data=$4::jsonb,
          latitude=$5,longitude=$6,coordinates_verified_at=$7,coordinates_source_url=$8`,
        [
          clinic.id,
          normalize(clinic.city),
          clinic.insurances.map(normalize),
          JSON.stringify(clinic),
          clinic.latitude,
          clinic.longitude,
          clinic.coordinatesVerifiedAt,
          clinic.coordinatesSourceUrl,
        ],
      );
      await tx.query('DELETE FROM clinic_specialties WHERE clinic_id=$1', [clinic.id]);
      await tx.query(
        `INSERT INTO clinic_specialties(clinic_id,specialty_id)
        SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [clinic.id, clinic.specialties],
      );
    }
  }

  private visibility = `(data->>'active')::boolean = true AND
    (($1::boolean AND (data->>'isDemo')::boolean) OR
      ((data->>'isDemo')::boolean = false AND (data->>'verifiedAt')::timestamptz >= now() -
        interval '180 days' AND (data->>'verifiedAt')::timestamptz <= now()))`;

  async search(
    filters: ClinicFilters,
    specialtyIds?: string[],
    clinicIds?: string[],
  ): Promise<ClinicResults> {
    const ids = specialtyIds ?? (filters.specialty ? [filters.specialty] : []);
    const { rows } = await this.db.query<{
      data: Clinic;
      latitude: number | null;
      longitude: number | null;
      details: Specialty[];
    }>(
      `SELECT c.data,c.latitude,c.longitude,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name,s.id),'[]')
          FROM clinic_specialties cs JOIN specialties s ON s.id=cs.specialty_id
          WHERE cs.clinic_id=c.id AND s.active) AS details
        FROM clinics c WHERE ${this.visibility}
          AND ($6::text[] IS NULL OR c.id=ANY($6::text[]))
          AND ($2='' OR city_key=$2) AND ($3='' OR $3=ANY(insurance_keys))
          AND EXISTS (SELECT 1 FROM clinic_specialties cs JOIN specialties s ON s.id=cs.specialty_id
            WHERE cs.clinic_id=c.id AND s.active AND (cardinality($4::text[])=0 OR s.id=ANY($4::text[])))
          AND NOT EXISTS (SELECT 1 FROM unnest($5::text[]) AS term
            WHERE strpos(translate(lower(concat_ws(' ',data->>'name',data->>'neighborhood',data->>'address')),
              'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),term)=0)`,
      [
        this.allowDemo,
        normalize(filters.city),
        normalize(filters.insurance),
        ids,
        normalize(filters.q ?? '')
          .split(/\s+/)
          .filter(Boolean),
        clinicIds ?? null,
      ],
    );
    // Small curated MVP catalog: filter in SQL, compute/sort ALL candidates, then paginate.
    const items = rows.map(({ data, latitude, longitude, details }) => ({
      ...data,
      latitude,
      longitude,
      specialties: details.map((s) => s.id),
      specialtyDetails: details,
      distanceKm:
        filters.location && latitude !== null && longitude !== null
          ? distanceKm(filters.location.latitude, filters.location.longitude, latitude, longitude)
          : null,
    }));
    items.sort((a, b) => {
      if (filters.location) {
        const proximity = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        if (proximity && !Number.isNaN(proximity)) return proximity;
      } else if (a.isDemo !== b.isDemo) return Number(a.isDemo) - Number(b.isDemo);
      return a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id);
    });
    return {
      items: items.slice((filters.page - 1) * 6, filters.page * 6),
      total: items.length,
      page: filters.page,
      pageSize: 6,
      order: filters.location ? 'proximity' : 'name',
    };
  }

  async mentionedClinics(text: string): Promise<string[]> {
    const words = new Set(
      normalize(text)
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/),
    );
    const generic = new Set([
      'clinica',
      'clinicas',
      'medica',
      'medico',
      'centro',
      'instituto',
      'fortaleza',
      'eusebio',
      'maracanau',
      'unidade',
      'de',
      'do',
      'da',
      'dos',
      'das',
      'saude',
    ]);
    const rows = (
      await this.db.query<{ id: string; name: string }>(
        `SELECT id,data->>'name' AS name FROM clinics WHERE ${this.visibility}`,
        [this.allowDemo],
      )
    ).rows;
    const taxonomy = await this.db.query<{ normalized_name: string; aliases: string[] }>(
      'SELECT normalized_name,aliases FROM specialties',
    );
    for (const entry of taxonomy.rows)
      for (const term of [entry.normalized_name, ...entry.aliases])
        for (const word of term.split(/\s+/)) generic.add(word);
    const matches = rows.map((row) => ({
      id: row.id,
      score: normalize(row.name)
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !generic.has(word) && words.has(word)).length,
    }));
    const maximum = Math.max(0, ...matches.map((match) => match.score));
    return maximum
      ? matches.filter((match) => match.score === maximum).map((match) => match.id)
      : [];
  }

  async metadata() {
    const { rows } = await this.db.query<{ data: Clinic }>(
      `SELECT data FROM clinics c WHERE ${this.visibility}
        AND EXISTS (SELECT 1 FROM clinic_specialties cs JOIN specialties s ON s.id=cs.specialty_id
          WHERE cs.clinic_id=c.id AND s.active)`,
      [this.allowDemo],
    );
    return {
      cities: [...new Set(rows.map(({ data }) => data.city))].sort(),
      insurances: [...new Set(rows.flatMap(({ data }) => data.insurances))].sort(),
      specialties: await new SpecialtyRepository(this.db).list(),
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
