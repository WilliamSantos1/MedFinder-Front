import type { KnowledgeDocument } from '../../shared/contracts.js';
import { vectorLiteral, type AIProvider, type Evidence } from '../ai/provider.js';
import type { Database } from '../db/database.js';
import { tokens } from '../domain/text.js';

interface Row {
  id: string;
  content: string;
  data: KnowledgeDocument;
  cosine: number;
  lexical: number;
}

export class Retriever {
  constructor(
    private readonly db: Database,
    private readonly provider: AIProvider,
    private readonly allowDemo: boolean,
  ) {}

  async search(query: string): Promise<Evidence[]> {
    const words = [...new Set(tokens(query))].slice(0, 60);
    if (!words.length) return [];
    const [embedding] = await this.provider.embed([query]);
    // Exact cosine search is intentional for this small curated corpus. A measured
    // migration to HNSW can follow when the collection grows; no approximate misses now.
    const { rows } = await this.db.query<Row>(
      `
      WITH eligible AS MATERIALIZED (
        SELECT c.id,c.content,c.search_vector,c.embedding,d.data
        FROM chunks c JOIN documents d ON d.id=c.document_id
        WHERE d.embedding_model=$3 AND (d.data->>'active')::boolean=true
          AND (($4::boolean AND (d.data->>'isDemo')::boolean)
            OR ((d.data->>'isDemo')::boolean=false AND d.data->>'reviewStatus'='approved'
              AND (d.data->>'reviewedAt')::timestamptz >= now()-interval '365 days'))
      )
      SELECT c.id,c.content,c.data,1-(c.embedding <=> $1::vector) AS cosine,
        ts_rank_cd(c.search_vector,websearch_to_tsquery('portuguese',$2)) AS lexical
      FROM eligible c
      ORDER BY (0.7*(1-(c.embedding <=> $1::vector)) +
        0.3*LEAST(ts_rank_cd(c.search_vector,websearch_to_tsquery('portuguese',$2)),1)) DESC
      LIMIT 12`,
      [
        vectorLiteral(embedding, this.provider.embeddingDimensions),
        words.join(' OR '),
        this.provider.embeddingModel,
        this.allowDemo,
      ],
    );
    const seen = new Set<string>();
    return rows
      .filter((row) => {
        // Offline hashing cannot be interpreted as semantic evidence.
        if (row.lexical <= 0 && (this.provider.mode === 'demo' || row.cosine < 0.38)) return false;
        if (seen.has(row.data.id)) return false;
        seen.add(row.data.id);
        return true;
      })
      .slice(0, 4)
      .map((row) => ({
        id: row.id,
        title: row.data.title,
        url: row.data.sourceUrl,
        publisher: row.data.publisher,
        excerpt: row.content.slice(0, 350),
        content: row.content,
        specialties: row.data.specialties,
        reviewStatus: row.data.reviewStatus,
        score: row.cosine * 0.7 + Math.min(row.lexical, 1) * 0.3,
      }));
  }
}
