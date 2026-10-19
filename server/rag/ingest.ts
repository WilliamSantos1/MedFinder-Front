import { createHash } from 'node:crypto';
import { clinicDocumentSchema, type ClinicDocument } from '../../shared/contracts.js';
import { vectorLiteral, type AIProvider } from '../ai/provider.js';
import type { Database } from '../db/database.js';
import { normalize } from '../domain/text.js';

export function chunkText(text: string, size = 900, overlap = 120): string[] {
  if (size <= overlap || overlap < 0) throw new Error('Tamanho de chunk inválido.');
  const clean = text.replace(/\s+/g, ' ').trim();
  const chunks: string[] = [];
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(' ', end);
      if (boundary > start + size / 2) end = boundary;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end === clean.length) break;
    const next = Math.max(start + 1, end - overlap);
    const boundary = clean.indexOf(' ', next);
    start = boundary >= next && boundary < end ? boundary + 1 : next;
  }
  return chunks;
}

export async function ingestDocument(
  db: Database,
  provider: AIProvider,
  raw: ClinicDocument,
  options: { force?: boolean; preserveNewer?: boolean } = {},
) {
  const doc = clinicDocumentSchema.parse(raw);
  const clinic = await db.query<{
    data: { isDemo: boolean; sourceUrl: string | null; website: string | null };
  }>('SELECT data FROM clinics WHERE id=$1', [doc.clinicId]);
  const record = clinic.rows[0]?.data;
  if (!record || record.isDemo !== doc.isDemo)
    throw new Error('Documento deve pertencer a uma clínica do mesmo tipo (real/demo).');
  if (
    !doc.isDemo &&
    ![record.sourceUrl, record.website].some(
      (url) =>
        url &&
        new URL(url).hostname.replace(/^www\./, '') ===
          new URL(doc.sourceUrl!).hostname.replace(/^www\./, ''),
    )
  )
    throw new Error('Use uma fonte do site oficial já verificado para esta clínica.');
  const hash = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  const existing = await db.query<{
    content_hash: string;
    embedding_model: string;
    verified_at: Date | string | null;
  }>('SELECT content_hash,embedding_model,verified_at FROM clinic_documents WHERE id=$1', [doc.id]);
  const existingDate = existing.rows[0]?.verified_at;
  if (
    options.preserveNewer &&
    existingDate &&
    doc.verifiedAt &&
    new Date(existingDate).getTime() > Date.parse(doc.verifiedAt)
  )
    return false;
  if (
    !options.force &&
    existing.rows[0]?.content_hash === hash &&
    existing.rows[0]?.embedding_model === provider.embeddingModel
  )
    return false;
  const chunks = chunkText(doc.content);
  const searchTexts = chunks.map((chunk) => `${doc.title}. ${chunk}`);
  // Compute the entire new version before changing anything in the database.
  const embeddings = await provider.embed(searchTexts);
  if (embeddings.length !== chunks.length) throw new Error('Lote de embeddings incompleto.');
  const vectors = embeddings.map((embedding) =>
    vectorLiteral(embedding, provider.embeddingDimensions),
  );
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO clinic_documents(id,clinic_id,title,content,source_url,verified_at,content_hash,embedding_model,active,is_demo)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(id) DO UPDATE SET clinic_id=$2,title=$3,content=$4,source_url=$5,verified_at=$6,
          content_hash=$7,embedding_model=$8,active=$9,is_demo=$10`,
      [
        doc.id,
        doc.clinicId,
        doc.title,
        doc.content,
        doc.sourceUrl,
        doc.verifiedAt,
        hash,
        provider.embeddingModel,
        doc.active,
        doc.isDemo,
      ],
    );
    await tx.query('DELETE FROM clinic_chunks WHERE document_id=$1', [doc.id]);
    for (let index = 0; index < chunks.length; index++) {
      await tx.query(
        'INSERT INTO clinic_chunks(id,document_id,content,search_text,embedding) VALUES($1,$2,$3,$4,$5::vector)',
        [
          `${doc.id}:${hash.slice(0, 12)}:${index}`,
          doc.id,
          chunks[index],
          normalize(searchTexts[index]),
          vectors[index],
        ],
      );
    }
  });
  return true;
}
