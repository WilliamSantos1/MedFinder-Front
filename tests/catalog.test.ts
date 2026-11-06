import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clinicSchema, type Clinic } from '../shared/contracts.js';
import { readConfig } from '../server/config.js';
import { connectDatabase, type Database } from '../server/db/database.js';
import { migrate } from '../server/db/migrations.js';
import { CatalogRepository } from '../server/db/catalog.js';
import { loadPublicCatalog, readPublicCatalog } from '../server/services/public-catalog.js';
import { seedDevelopment } from '../server/db/seed.js';
import { demoProvider } from '../server/ai/demo.js';
import { buildApp } from '../server/app.js';

const config = readConfig({ NODE_ENV: 'test', DATA_DIR: 'memory://' });
const filters = { city: '', insurance: '', specialty: '' as const, page: 1 };
let db: Database;
let catalog: CatalogRepository;
let clinics: Clinic[];
let temporary: string;
beforeAll(async () => {
  db = await connectDatabase(config);
  await migrate(db);
  clinics = await readPublicCatalog();
  catalog = new CatalogRepository(db, true);
  temporary = await mkdtemp(join(tmpdir(), 'medfinder-catalog-'));
});
beforeEach(async () => {
  await db.exec('TRUNCATE clinics, catalog_collections, clinic_documents CASCADE');
});
afterAll(async () => {
  await db?.close();
  await rm(temporary, { recursive: true, force: true });
});

describe('Catálogo real independente de provedores de diretório', () => {
  it('carrega 50 unidades, quatro cidades e especialidades cobertas com fontes próprias', async () => {
    await loadPublicCatalog(db);
    expect(clinics).toHaveLength(50);
    expect(new Set(clinics.map((c) => c.id)).size).toBe(50);
    expect(new Set(clinics.flatMap((c) => c.specialties))).toEqual(
      new Set([
        'alergologia-imunologia',
        'angiologia',
        'cardiologia',
        'cirurgia-aparelho-digestivo',
        'cirurgia-cabeca-pescoco',
        'cirurgia-geral',
        'cirurgia-mao',
        'cirurgia-oncologica',
        'cirurgia-vascular',
        'clinica-medica',
        'coloproctologia',
        'dermatologia',
        'endocrinologia',
        'gastroenterologia',
        'geriatria',
        'ginecologia',
        'hematologia',
        'infectologia',
        'mastologia',
        'nefrologia',
        'neurocirurgia',
        'neurologia',
        'nutrologia',
        'oftalmologia',
        'oncologia-clinica',
        'ortopedia',
        'otorrinolaringologia',
        'pediatria',
        'pneumologia',
        'psicologia',
        'psiquiatria',
        'radioterapia',
        'reumatologia',
        'urologia',
      ]),
    );
    expect(
      clinics.every(
        (c) =>
          !c.isDemo &&
          c.sourceUrl &&
          c.verifiedAt &&
          ['official-website', 'public-directory'].includes(c.provenance ?? ''),
      ),
    ).toBe(true);
    expect(await catalog.metadata()).toMatchObject({
      total: 50,
      realRecords: 50,
      demoData: false,
      cities: ['Caucaia', 'Eusébio', 'Fortaleza', 'Maracanaú'],
      sourceCount: 38,
    });
  });
  it('mantém coordenadas verificadas, fontes, taxonomia e unidades únicas; ordena o catálogo real antes de paginar', async () => {
    const audit = JSON.parse(await readFile('data/coordinates.provenance.json', 'utf8')) as {
      clinicId: string;
      latitude: number;
      longitude: number;
      coordinatesSourceUrl: string;
    }[];
    expect(audit).toHaveLength(35);
    expect(new Set(clinics.map((c) => `${c.city}|${c.address}`)).size).toBe(clinics.length);
    await loadPublicCatalog(db);
    const meta = await catalog.metadata();
    for (const clinic of clinics) {
      const audited = audit.find((a) => a.clinicId === clinic.id);
      if (audited) {
        expect(clinic.latitude).not.toBeNull();
        expect(clinic.longitude).not.toBeNull();
        expect(audited).toMatchObject({
          latitude: clinic.latitude,
          longitude: clinic.longitude,
          coordinatesSourceUrl: clinic.coordinatesSourceUrl,
        });
      } else {
        // New catalog entries do not get invented coordinates; proximity stays unavailable
        // until an operator verifies the exact unit point and records its source.
        expect(clinic.latitude).toBeNull();
        expect(clinic.longitude).toBeNull();
      }
      expect(clinic.specialties.every((id) => meta.specialties.some((s) => s.id === id))).toBe(
        true,
      );
      for (const url of [clinic.sourceUrl, clinic.website, clinic.coordinatesSourceUrl].filter(
        Boolean,
      ))
        expect(new URL(url!).protocol).toBe('https:');
    }
    const search = { ...filters, location: { latitude: -3.88, longitude: -38.46 } };
    const items = [];
    for (let page = 1; page <= 9; page++)
      items.push(...(await catalog.search({ ...search, page })).items);
    const knownDistances = items.filter((c) => c.distanceKm !== null);
    expect(knownDistances).toHaveLength(35);
    expect(knownDistances[0].city).toBe('Eusébio');
    expect(knownDistances.map((c) => c.distanceKm)).toEqual(
      knownDistances.map((c) => c.distanceKm).sort((a, b) => a! - b!),
    );
    expect(items.slice(knownDistances.length).every((c) => c.distanceKm === null)).toBe(true);
    expect(
      (await catalog.search({ ...search, city: 'Fortaleza' })).items.every(
        (c) => c.city === 'Fortaleza',
      ),
    ).toBe(true);
  });
  it('preserva coordenadas verificadas mais recentemente pelo operador', async () => {
    const clinic = clinics.find(
      (candidate) => candidate.latitude !== null && candidate.longitude !== null,
    )!;
    await catalog.import([
      {
        ...clinic,
        latitude: clinic.latitude! + 0.00001,
        coordinatesVerifiedAt: new Date().toISOString(),
      },
    ]);
    await loadPublicCatalog(db);
    const result = await catalog.search({ ...filters, q: clinic.name });
    expect(result.items.find((c) => c.id === clinic.id)?.latitude).toBe(clinic.latitude! + 0.00001);
  });
  it('página, busca e filtros exatos funcionam sem perder ou repetir registros', async () => {
    await loadPublicCatalog(db);
    const ids: string[] = [];
    for (let page = 1; page <= 9; page++) {
      const result = await catalog.search({ ...filters, page });
      expect(result.total).toBe(50);
      ids.push(...result.items.map((clinic) => clinic.id));
    }
    expect(new Set(ids).size).toBe(50);
    expect((await catalog.search({ ...filters, q: 'clinica assis' })).items[0].id).toBe(
      'public-mario-de-assis',
    );
    expect(
      (
        await catalog.search({
          ...filters,
          q: 'JULIO LIMA',
          specialty: 'ortopedia',
          insurance: 'cassi',
          city: 'fortaleza',
        })
      ).items[0].id,
    ).toBe('public-cti');
    expect((await catalog.search({ ...filters, q: 'Fabiane Pomiecinski' })).items[0].id).toBe(
      'public-fabiane-alergia',
    );
    expect((await catalog.search({ ...filters, q: 'Ana Carolina Queiroz' })).items[0].id).toBe(
      'public-nohc-jose-lourenco',
    );
    expect(clinics.flatMap((clinic) => clinic.professionals).length).toBe(96);
    expect((await catalog.search({ ...filters, q: "%' OR 1=1 --" })).total).toBe(0);
    expect((await catalog.search({ ...filters, insurance: 'Plano inexistente' })).total).toBe(0);
  });
  it('distingue convênio desconhecido de cobertura confirmada e não o inventa', async () => {
    await loadPublicCatalog(db);
    expect((await catalog.search({ ...filters, q: 'ava' })).items[0].insurances).toEqual([]);
    expect((await catalog.search({ ...filters, q: 'ava', insurance: 'Unimed' })).total).toBe(0);
  });
  it('reimportar é idempotente e nunca renova automaticamente a data da fonte', async () => {
    await loadPublicCatalog(db);
    const before = await catalog.search(filters);
    await loadPublicCatalog(db);
    expect(await catalog.search(filters)).toEqual(before);
    await db.query("UPDATE clinics SET data=jsonb_set(data,'{verifiedAt}',to_jsonb($1::text))", [
      new Date(Date.now() - 181 * 86400000).toISOString(),
    ]);
    expect((await catalog.search(filters)).total).toBe(0);
  });
  it('substitui apenas a coleção pública, preserva cadastro manual e desativa exemplos', async () => {
    await loadPublicCatalog(db);
    await catalog.import([
      { ...clinics[0], id: 'manual-operador', provenance: 'manual' },
      { ...clinics[0], id: 'demo-legado', isDemo: true },
    ]);
    const path = join(temporary, 'snapshot.json');
    await writeFile(path, JSON.stringify([clinics[0]]));
    await loadPublicCatalog(db, path);
    expect((await catalog.search(filters)).total).toBe(2);
    expect((await catalog.search(filters)).items.map((c) => c.id).sort()).toEqual(
      [clinics[0].id, 'manual-operador'].sort(),
    );
    expect((await new CatalogRepository(db, true).search(filters)).total).toBe(2);
  });
  it('recusa snapshot inválido antes de alterar o banco', async () => {
    await loadPublicCatalog(db);
    const path = join(temporary, 'invalid.json');
    for (const data of [[], [clinics[0], clinics[0]], [{ ...clinics[0], sourceUrl: null }]]) {
      await writeFile(path, JSON.stringify(data));
      await expect(loadPublicCatalog(db, path)).rejects.toThrow();
      expect((await catalog.search(filters)).total).toBe(50);
    }
    expect(
      clinicSchema.safeParse({
        ...clinics[0],
        verifiedAt: new Date(Date.now() + 86400000).toISOString(),
      }).success,
    ).toBe(false);
  });
  it('retira o snapshot antigo da API durante a migração sem apagar registros', async () => {
    await catalog.import([{ ...clinics[0], id: 'legacy-api' }]);
    await db.exec("UPDATE clinics SET data=jsonb_set(data,'{provenance}','\"docplanner\"'::jsonb)");
    await db.exec('DROP TABLE catalog_collections; DELETE FROM schema_migrations WHERE version=3');
    await migrate(db);
    expect((await catalog.search(filters)).total).toBe(0);
    expect((await db.query('SELECT id FROM clinics')).rows).toHaveLength(1);
    await migrate(db);
  });
  it('a inicialização local entrega catálogo real sem exigir RAG médico ou chave', async () => {
    await seedDevelopment(db);
    const app = await buildApp(config, db, demoProvider);
    try {
      expect((await app.inject('/api/ready')).statusCode).toBe(200);
      const status = (await app.inject('/api/catalog')).json();
      expect(status).toMatchObject({
        mode: 'demo',
        demoData: false,
        knowledge: { indexedDocuments: 0 },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat',
        payload: {
          message: 'Estou com dor no pescoço desde ontem, piora ao movimentar, sem outros sintomas',
          city: 'Fortaleza',
          insurance: 'CASSI',
        },
      });
      expect(response.json().clinics.map((c: Clinic) => c.id)).toEqual(['public-cti']);
      expect((await app.inject('/api/clinics?q=JULIO%20LIMA')).json().items[0].id).toBe(
        'public-cti',
      );
      expect((await app.inject('/api/clinics?q=' + 'a'.repeat(101))).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
