// Immutable migration snapshots, not a runtime list of allowed specialties.
export const evolutionMigrations = [
  {
    version: 5,
    sql: `
      CREATE TABLE specialties (
        id text PRIMARY KEY, name text NOT NULL, normalized_name text NOT NULL UNIQUE,
        aliases text[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO specialties(id,name,normalized_name,aliases) VALUES
        ('clinica-medica','Clínica Médica','clinica medica',ARRAY['clinico geral','clinica geral','clinico']),
        ('medicina-de-familia','Medicina de Família e Comunidade','medicina de familia e comunidade',ARRAY['medicina de familia','medico de familia']),
        ('ortopedia','Ortopedia e Traumatologia','ortopedia e traumatologia',ARRAY['ortopedia','ortopedista']),
        ('dermatologia','Dermatologia','dermatologia',ARRAY['dermatologista']),
        ('neurologia','Neurologia','neurologia',ARRAY['neurologista']),
        ('gastroenterologia','Gastroenterologia','gastroenterologia',ARRAY['gastroenterologista']),
        ('otorrinolaringologia','Otorrinolaringologia','otorrinolaringologia',ARRAY['otorrino','otorrinolaringologista']),
        ('oftalmologia','Oftalmologia','oftalmologia',ARRAY['oftalmologista']),
        ('psicologia','Psicologia','psicologia',ARRAY['psicologo','psicologa']),
        ('urologia','Urologia','urologia',ARRAY['urologista']),
        ('cardiologia','Cardiologia','cardiologia',ARRAY['cardiologista']),
        ('reumatologia','Reumatologia','reumatologia',ARRAY['reumatologista']),
        ('endocrinologia','Endocrinologia e Metabologia','endocrinologia e metabologia',ARRAY['endocrinologia','endocrinologista']),
        ('pneumologia','Pneumologia','pneumologia',ARRAY['pneumologista']),
        ('nefrologia','Nefrologia','nefrologia',ARRAY['nefrologista']),
        ('ginecologia','Ginecologia e Obstetrícia','ginecologia e obstetricia',ARRAY['ginecologia','ginecologista','obstetricia','obstetra']);
      CREATE TABLE specialty_reference (
        id text PRIMARY KEY, name text NOT NULL, normalized_name text NOT NULL UNIQUE,
        aliases text[] NOT NULL DEFAULT '{}'
      );
      INSERT INTO specialty_reference SELECT id,name,normalized_name,aliases FROM specialties;
      INSERT INTO specialty_reference VALUES
        ('pediatria','Pediatria','pediatria',ARRAY['pediatra']),
        ('geriatria','Geriatria','geriatria',ARRAY['geriatra']),
        ('radiologia','Radiologia e Diagnóstico por Imagem','radiologia e diagnostico por imagem',ARRAY['radiologia','radiologista']);
      CREATE TABLE clinic_specialties (
        clinic_id text NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        specialty_id text NOT NULL REFERENCES specialties(id),
        PRIMARY KEY(clinic_id,specialty_id)
      );
      INSERT INTO clinic_specialties SELECT c.id,unnest(c.specialty_ids) FROM clinics c ON CONFLICT DO NOTHING;
      CREATE INDEX clinic_specialties_specialty_idx ON clinic_specialties(specialty_id,clinic_id);
      ALTER TABLE clinics DROP COLUMN specialty_ids;
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE clinics ADD COLUMN latitude double precision,
        ADD COLUMN longitude double precision,
        ADD COLUMN coordinates_verified_at timestamptz,
        ADD COLUMN coordinates_source_url text,
        ADD CONSTRAINT clinic_latitude_range CHECK (latitude BETWEEN -90 AND 90),
        ADD CONSTRAINT clinic_longitude_range CHECK (longitude BETWEEN -180 AND 180),
        ADD CONSTRAINT clinic_coordinate_pair CHECK ((latitude IS NULL)=(longitude IS NULL));
      CREATE TABLE clinic_documents (
        id text PRIMARY KEY, clinic_id text NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        title text NOT NULL, content text NOT NULL, source_url text, verified_at timestamptz,
        content_hash text NOT NULL, embedding_model text NOT NULL,
        active boolean NOT NULL, is_demo boolean NOT NULL,
        CHECK (is_demo OR (source_url IS NOT NULL AND verified_at IS NOT NULL))
      );
      CREATE INDEX clinic_documents_clinic_idx ON clinic_documents(clinic_id);
      CREATE TABLE clinic_chunks (
        id text PRIMARY KEY, document_id text NOT NULL REFERENCES clinic_documents(id) ON DELETE CASCADE,
        content text NOT NULL, search_text text NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (to_tsvector('portuguese',search_text)) STORED,
        embedding vector NOT NULL
      );
      CREATE INDEX clinic_chunks_document_idx ON clinic_chunks(document_id);
      CREATE INDEX clinic_chunks_search_idx ON clinic_chunks USING gin(search_vector);
      -- Preserve operator data for audit, explicitly retire medical RAG from runtime.
      ALTER TABLE documents RENAME TO legacy_medical_documents;
      ALTER TABLE chunks RENAME TO legacy_medical_chunks;
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE response_receipts (
        response_id uuid PRIMARY KEY, token_hash text NOT NULL,
        mode text NOT NULL, prompt_version text NOT NULL, allowed_reasons text[] NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX response_receipts_created_idx ON response_receipts(created_at);
      CREATE TABLE ai_feedback (
        id uuid PRIMARY KEY, response_id uuid NOT NULL UNIQUE,
        rating text NOT NULL CHECK (rating IN ('positive','negative')),
        reason text CHECK (reason IN ('incorrect_specialty','unclear_answer','not_helpful','clinic_problem','location_problem','insurance_problem','too_slow','other')),
        comment text CHECK (length(comment)<=500),
        mode text NOT NULL, prompt_version text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((rating='positive' AND reason IS NULL AND comment IS NULL) OR (rating='negative' AND reason IS NOT NULL))
      );
    `,
  },
  {
    version: 8,
    sql: `
      -- Append explicit, unambiguous popular names; preserve operator aliases and activation.
      WITH additions(id,terms) AS (VALUES
        ('oftalmologia',ARRAY['oculista','oftalmo']),
        ('dermatologia',ARRAY['dermato']), ('neurologia',ARRAY['neuro']),
        ('cardiologia',ARRAY['cardio']), ('urologia',ARRAY['uro']),
        ('reumatologia',ARRAY['reumato']), ('endocrinologia',ARRAY['endocrino']),
        ('pneumologia',ARRAY['pneumo']), ('nefrologia',ARRAY['nefro']),
        ('ginecologia',ARRAY['gineco']), ('gastroenterologia',ARRAY['gastro']),
        ('ortopedia',ARRAY['traumatologia','traumatologista'])
      )
      UPDATE specialties s SET aliases=ARRAY(
        SELECT DISTINCT term FROM unnest(s.aliases || a.terms) term
        WHERE NOT EXISTS (SELECT 1 FROM specialty_reference r WHERE r.id<>s.id
          AND (r.normalized_name=term OR term=ANY(r.aliases)))
      ),updated_at=now() FROM additions a WHERE s.id=a.id;
      UPDATE specialty_reference r SET aliases=s.aliases FROM specialties s WHERE s.id=r.id;
    `,
  },
  {
    version: 9,
    sql: `
      -- Product scope: retain history/relations, but exclude this area from active navigation.
      UPDATE specialties SET active=false,updated_at=now() WHERE id='medicina-de-familia';
    `,
  },
  {
    version: 10,
    sql: `
      -- Enable the existing canonical reference for age-aware navigation.
      -- Preserve a previously configured operator record, including its activity state.
      INSERT INTO specialties(id,name,normalized_name,aliases)
      SELECT id,name,normalized_name,aliases FROM specialty_reference WHERE id='pediatria'
      ON CONFLICT(id) DO NOTHING;
    `,
  },
  {
    version: 11,
    sql: `
      -- O comprovante passa a lembrar quais clínicas foram indicadas naquela resposta.
      ALTER TABLE response_receipts ADD COLUMN clinic_ids text[] NOT NULL DEFAULT '{}';
      CREATE TABLE clinic_visit_feedback (
        response_id uuid NOT NULL,
        clinic_id text NOT NULL,
        rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment text CHECK (length(comment)<=500),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (response_id, clinic_id)
      );
    `,
  },
  {
    version: 12,
    sql: `
      -- Expand the active navigation taxonomy using specialties published by verified local clinics.
      INSERT INTO specialty_reference(id,name,normalized_name,aliases) VALUES
        ('alergologia-imunologia','Alergologia e Imunologia','alergologia e imunologia',ARRAY['alergologia','alergista','imunologia','imunologista','alergologista']),
        ('psiquiatria','Psiquiatria','psiquiatria',ARRAY['psiquiatra']),
        ('hematologia','Hematologia','hematologia',ARRAY['hematologista']),
        ('oncologia-clinica','Oncologia Clínica','oncologia clinica',ARRAY['oncologia','oncologista','oncologista clinico']),
        ('infectologia','Infectologia','infectologia',ARRAY['infectologista']),
        ('cirurgia-vascular','Cirurgia Vascular e Angiologia','cirurgia vascular e angiologia',ARRAY['cirurgia vascular','cirurgiao vascular','angiologia','angiologista','vascular']),
        ('mastologia','Mastologia','mastologia',ARRAY['mastologista']),
        ('coloproctologia','Coloproctologia','coloproctologia',ARRAY['proctologia','proctologista','coloproctologista']),
        ('cirurgia-geral','Cirurgia Geral','cirurgia geral',ARRAY['cirurgiao geral']),
        ('neurocirurgia','Neurocirurgia','neurocirurgia',ARRAY['neurocirurgiao'])
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, normalized_name=excluded.normalized_name,
        aliases=excluded.aliases;

      INSERT INTO specialties(id,name,normalized_name,aliases)
      SELECT id,name,normalized_name,aliases FROM specialty_reference
      WHERE id IN ('geriatria','alergologia-imunologia','psiquiatria','hematologia','oncologia-clinica',
        'infectologia','cirurgia-vascular','mastologia','coloproctologia','cirurgia-geral','neurocirurgia')
      ON CONFLICT(id) DO NOTHING;
    `,
  },

  {
    version: 13,
    sql: `
      -- CFM/CME 2026 reference taxonomy (Resolução CFM 2.472/2026).
      -- Keep Psicologia as a separate MedFinder care area; preserve operator activation states.
      INSERT INTO specialty_reference(id,name,normalized_name,aliases) VALUES
        ('acupuntura','Acupuntura','acupuntura',ARRAY['acupunturista']),
        ('alergologia-imunologia','Alergia e Imunologia','alergia e imunologia',ARRAY['alergologia','alergista','imunologia','imunologista','alergologista']),
        ('anestesiologia','Anestesiologia','anestesiologia',ARRAY['anestesista','anestesiologista']),
        ('angiologia','Angiologia','angiologia',ARRAY['angiologista']),
        ('cardiologia','Cardiologia','cardiologia',ARRAY['cardiologista','cardio']),
        ('cirurgia-cardiovascular','Cirurgia Cardiovascular','cirurgia cardiovascular',ARRAY['cirurgiao cardiovascular']),
        ('cirurgia-mao','Cirurgia da Mão','cirurgia da mao',ARRAY['cirurgiao da mao']),
        ('cirurgia-cabeca-pescoco','Cirurgia de Cabeça e Pescoço','cirurgia de cabeca e pescoco',ARRAY['cirurgiao de cabeca e pescoco']),
        ('cirurgia-aparelho-digestivo','Cirurgia do Aparelho Digestivo','cirurgia do aparelho digestivo',ARRAY['cirurgiao do aparelho digestivo']),
        ('cirurgia-geral','Cirurgia Geral','cirurgia geral',ARRAY['cirurgiao geral']),
        ('cirurgia-oncologica','Cirurgia Oncológica','cirurgia oncologica',ARRAY['cirurgiao oncologico','cirurgia do cancer']),
        ('cirurgia-pediatrica','Cirurgia Pediátrica','cirurgia pediatrica',ARRAY['cirurgiao pediatrico']),
        ('cirurgia-plastica','Cirurgia Plástica','cirurgia plastica',ARRAY['cirurgiao plastico']),
        ('cirurgia-toracica','Cirurgia Torácica','cirurgia toracica',ARRAY['cirurgiao toracico']),
        ('cirurgia-vascular','Cirurgia Vascular','cirurgia vascular',ARRAY['cirurgiao vascular','vascular']),
        ('clinica-medica','Clínica Médica','clinica medica',ARRAY['clinico geral','clinica geral','clinico','internista']),
        ('coloproctologia','Coloproctologia','coloproctologia',ARRAY['proctologia','proctologista','coloproctologista']),
        ('dermatologia','Dermatologia','dermatologia',ARRAY['dermatologista','dermato']),
        ('endocrinologia','Endocrinologia e Metabologia','endocrinologia e metabologia',ARRAY['endocrinologia','endocrinologista','endocrino']),
        ('endoscopia','Endoscopia','endoscopia',ARRAY['endoscopista']),
        ('gastroenterologia','Gastroenterologia','gastroenterologia',ARRAY['gastroenterologista','gastro']),
        ('genetica-medica','Genética Médica','genetica medica',ARRAY['geneticista','geneticista medico']),
        ('geriatria','Geriatria','geriatria',ARRAY['geriatra']),
        ('ginecologia','Ginecologia e Obstetrícia','ginecologia e obstetricia',ARRAY['ginecologia','ginecologista','obstetricia','obstetra','gineco']),
        ('hematologia','Hematologia e Hemoterapia','hematologia e hemoterapia',ARRAY['hematologia','hematologista','hemoterapia']),
        ('homeopatia','Homeopatia','homeopatia',ARRAY['homeopata']),
        ('infectologia','Infectologia','infectologia',ARRAY['infectologista']),
        ('mastologia','Mastologia','mastologia',ARRAY['mastologista']),
        ('medicina-emergencia','Medicina de Emergência','medicina de emergencia',ARRAY['medico emergencista','emergencista']),
        ('medicina-de-familia','Medicina de Família e Comunidade','medicina de familia e comunidade',ARRAY['medicina de familia','medico de familia']),
        ('medicina-trabalho','Medicina do Trabalho','medicina do trabalho',ARRAY['medico do trabalho']),
        ('medicina-trafego','Medicina do Tráfego','medicina do trafego',ARRAY['medico do trafego']),
        ('medicina-esportiva','Medicina Esportiva','medicina esportiva',ARRAY['medicina do esporte','medico do esporte']),
        ('medicina-fisica-reabilitacao','Medicina Física e Reabilitação','medicina fisica e reabilitacao',ARRAY['fisiatria','fisiatra']),
        ('medicina-intensiva','Medicina Intensiva','medicina intensiva',ARRAY['intensivista','medico intensivista']),
        ('medicina-legal-pericia','Medicina Legal e Perícia Médica','medicina legal e pericia medica',ARRAY['medicina legal','pericia medica','medico perito']),
        ('medicina-nuclear','Medicina Nuclear','medicina nuclear',ARRAY['medico nuclear']),
        ('medicina-preventiva-social','Medicina Preventiva e Social','medicina preventiva e social',ARRAY['medicina preventiva']),
        ('nefrologia','Nefrologia','nefrologia',ARRAY['nefrologista','nefro']),
        ('neurocirurgia','Neurocirurgia','neurocirurgia',ARRAY['neurocirurgiao']),
        ('neurologia','Neurologia','neurologia',ARRAY['neurologista','neuro']),
        ('nutrologia','Nutrologia','nutrologia',ARRAY['nutrologo','nutrologa']),
        ('oftalmologia','Oftalmologia','oftalmologia',ARRAY['oftalmologista','oculista','oftalmo']),
        ('oncologia-clinica','Oncologia Clínica','oncologia clinica',ARRAY['oncologia','oncologista','oncologista clinico']),
        ('ortopedia','Ortopedia e Traumatologia','ortopedia e traumatologia',ARRAY['ortopedia','ortopedista','traumatologia','traumatologista']),
        ('otorrinolaringologia','Otorrinolaringologia','otorrinolaringologia',ARRAY['otorrino','otorrinolaringologista']),
        ('patologia','Patologia','patologia',ARRAY['patologista']),
        ('patologia-clinica','Patologia Clínica/Medicina Laboratorial','patologia clinica medicina laboratorial',ARRAY['patologia clinica','medicina laboratorial','patologista clinico']),
        ('pediatria','Pediatria','pediatria',ARRAY['pediatra']),
        ('pneumologia','Pneumologia','pneumologia',ARRAY['pneumologista','pneumo']),
        ('psiquiatria','Psiquiatria','psiquiatria',ARRAY['psiquiatra']),
        ('radiologia','Radiologia e Diagnóstico por Imagem','radiologia e diagnostico por imagem',ARRAY['radiologia','radiologista','diagnostico por imagem']),
        ('radioterapia','Radioterapia','radioterapia',ARRAY['radioterapeuta']),
        ('reumatologia','Reumatologia','reumatologia',ARRAY['reumatologista','reumato']),
        ('urologia','Urologia','urologia',ARRAY['urologista','uro'])
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,normalized_name=excluded.normalized_name,
        aliases=excluded.aliases;

      -- Align labels/aliases without changing an operator's active/inactive decision.
      UPDATE specialties s SET name=r.name,normalized_name=r.normalized_name,aliases=r.aliases,updated_at=now()
        FROM specialty_reference r WHERE s.id=r.id;

      -- Make all missing CFM specialties resolvable for direct navigation. The product's prior
      -- decision keeps Medicina de Família e Comunidade inactive, and existing operator rows keep
      -- their current activation state.
      INSERT INTO specialties(id,name,normalized_name,aliases,active)
      SELECT id,name,normalized_name,aliases,true FROM specialty_reference
      WHERE id<>'medicina-de-familia' AND id<>'psicologia'
      ON CONFLICT(id) DO NOTHING;
      UPDATE specialties SET active=false,updated_at=now() WHERE id='medicina-de-familia';
    `,
  },
];
