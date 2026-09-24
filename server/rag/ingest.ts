import { createHash } from 'node:crypto';
import { documentSchema, type KnowledgeDocument } from '../../shared/contracts.js';
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
  raw: KnowledgeDocument,
  options: { force?: boolean } = {},
) {
  const doc = documentSchema.parse(raw);
  const hash = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  const existing = await db.query<{ content_hash: string; embedding_model: string }>(
    'SELECT content_hash,embedding_model FROM documents WHERE id=$1',
    [doc.id],
  );
  if (
    !options.force &&
    existing.rows[0]?.content_hash === hash &&
    existing.rows[0]?.embedding_model === provider.embeddingModel
  )
    return false;
  const chunks = chunkText(doc.content);
  const searchTexts = chunks.map((chunk) => `${doc.title}. ${doc.keywords.join(' ')}. ${chunk}`);
  // Compute the entire new version before changing anything in the database.
  const embeddings = await provider.embed(searchTexts);
  if (embeddings.length !== chunks.length) throw new Error('Lote de embeddings incompleto.');
  const vectors = embeddings.map((embedding) =>
    vectorLiteral(embedding, provider.embeddingDimensions),
  );
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO documents(id,content_hash,embedding_model,data) VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(id) DO UPDATE SET content_hash=$2,embedding_model=$3,data=$4::jsonb`,
      [doc.id, hash, provider.embeddingModel, JSON.stringify(doc)],
    );
    await tx.query('DELETE FROM chunks WHERE document_id=$1', [doc.id]);
    for (let index = 0; index < chunks.length; index++) {
      await tx.query(
        'INSERT INTO chunks(id,document_id,content,search_text,embedding) VALUES($1,$2,$3,$4,$5::vector)',
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
