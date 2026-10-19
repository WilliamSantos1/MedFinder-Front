import type { ChatResponse, Source } from '../../shared/contracts.js';
import { vectorLiteral, type AIProvider } from '../ai/provider.js';
import type { Database } from '../db/database.js';
import { tokens } from '../domain/text.js';

interface Row {
  id: string;
  content: string;
  document_id: string;
  clinic_id: string;
  title: string;
  source_url: string | null;
  is_demo: boolean;
  clinic_name: string;
  cosine: number;
  lexical: number;
}
export class Retriever {
  constructor(
    private readonly db: Database,
    private readonly provider: AIProvider,
    private readonly allowDemo: boolean,
  ) {}

  async search(
    query: string,
    clinicIds: string[],
  ): Promise<{ sources: Source[]; status: ChatResponse['ragStatus'] }> {
    if (!clinicIds.length) return { sources: [], status: 'skipped' };
    const words = [...new Set(tokens(query))].slice(0, 60);
    const params = [clinicIds, this.provider.embeddingModel, this.allowDemo];
    const eligibility = `d.clinic_id=ANY($1::text[]) AND d.embedding_model=$2 AND d.active
      AND (c.data->>'active')::boolean AND
      (($3::boolean AND d.is_demo AND (c.data->>'isDemo')::boolean) OR
        (NOT d.is_demo AND NOT (c.data->>'isDemo')::boolean
          AND d.verified_at BETWEEN now()-interval '365 days' AND now()
          AND (c.data->>'verifiedAt')::timestamptz BETWEEN now()-interval '180 days' AND now()))`;
    // Missing or incompatible optional indexes must not trigger an embedding request.
    const available = await this.db.query(
      `SELECT d.id FROM clinic_documents d JOIN clinics c ON c.id=d.clinic_id
      WHERE ${eligibility} LIMIT 1`,
      params,
    );
    if (!available.rows.length) return { sources: [], status: 'not_indexed' };
    if (!words.length) return { sources: [], status: 'no_matches' };
    const [embedding] = await this.provider.embed([query]);
    const { rows } = await this.db.query<Row>(
      `
      WITH eligible AS MATERIALIZED (
        SELECT ch.id,ch.document_id,ch.content,ch.search_vector,ch.embedding,
          d.clinic_id,d.title,d.source_url,d.is_demo,c.data->>'name' AS clinic_name
        FROM clinic_chunks ch JOIN clinic_documents d ON d.id=ch.document_id
          JOIN clinics c ON c.id=d.clinic_id WHERE ${eligibility}
      )
      SELECT e.*,1-(e.embedding <=> $4::vector) AS cosine,
        ts_rank_cd(e.search_vector,websearch_to_tsquery('portuguese',$5)) AS lexical
      FROM eligible e ORDER BY (0.7*(1-(e.embedding <=> $4::vector)) +
        0.3*LEAST(ts_rank_cd(e.search_vector,websearch_to_tsquery('portuguese',$5)),1)) DESC,e.id LIMIT 12`,
      [...params, vectorLiteral(embedding, this.provider.embeddingDimensions), words.join(' OR ')],
    );
    const seen = new Set<string>();
    const sources = rows
      .filter((row) => {
        if (row.lexical <= 0 && (this.provider.mode === 'demo' || row.cosine < 0.38)) return false;
        if (seen.has(row.document_id)) return false;
        seen.add(row.document_id);
        return true;
      })
      .slice(0, 4)
      .map((row) => ({
        id: row.id,
        clinicId: row.clinic_id,
        title: row.title,
        url: row.source_url,
        publisher: row.clinic_name,
        excerpt: row.content.slice(0, 350),
        isDemo: row.is_demo,
      }));
    return { sources, status: sources.length ? 'available' : 'no_matches' };
  }
}
