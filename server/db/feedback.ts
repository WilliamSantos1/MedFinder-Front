import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  ChatResponse,
  FeedbackReason,
  FeedbackRequest,
  VisitFeedbackRequest,
} from '../../shared/contracts.js';
import { PROMPT_VERSION } from '../ai/prompt.js';
import { redactIdentifiers } from '../domain/text.js';
import type { Database } from './database.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export class FeedbackRepository {
  constructor(private readonly db: Database) {}

  async issue(
    response: ChatResponse,
    insuranceUsed: boolean,
  ): Promise<NonNullable<ChatResponse['feedback']>> {
    const reasons: FeedbackReason[] = ['unclear_answer', 'not_helpful', 'too_slow', 'other'];
    if (response.specialty) reasons.unshift('incorrect_specialty');
    if (response.clinics.length) reasons.push('clinic_problem');
    if (response.locationUsed) reasons.push('location_problem');
    if (insuranceUsed && (response.specialty || response.intent !== 'care_navigation'))
      reasons.push('insurance_problem');
    const token = randomBytes(32).toString('hex');
    await this.db.query(
      `INSERT INTO response_receipts(response_id,token_hash,mode,prompt_version,allowed_reasons,clinic_ids)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [
        response.id,
        digest(token),
        response.mode,
        PROMPT_VERSION,
        reasons,
        response.clinics.map((clinic) => clinic.id),
      ],
    );
    return { token, reasons };
  }

  async save(input: FeedbackRequest): Promise<boolean> {
    // The receipt is a capability: clients cannot forge metadata or vote on arbitrary response IDs.
    // Only metadata is stored; there is no chat body, location, prompt or answer here.
    const comment =
      input.rating === 'negative' && input.comment
        ? redactIdentifiers(input.comment).slice(0, 500)
        : null;
    const result = await this.db.query(
      `
      INSERT INTO ai_feedback(id,response_id,rating,reason,comment,mode,prompt_version)
      SELECT $1,r.response_id,$2,$3,$4,r.mode,r.prompt_version FROM response_receipts r
      WHERE r.response_id=$5 AND r.token_hash=$6 AND r.created_at>now()-interval '7 days'
        AND ($2='positive' OR $3=ANY(r.allowed_reasons))
      ON CONFLICT(response_id) DO UPDATE SET rating=EXCLUDED.rating,reason=EXCLUDED.reason,
        comment=EXCLUDED.comment,updated_at=now()
      RETURNING id`,
      [
        randomUUID(),
        input.rating,
        input.reason ?? null,
        comment,
        input.responseId,
        digest(input.token),
      ],
    );
    return result.rows.length === 1;
  }

  async saveVisit(input: VisitFeedbackRequest): Promise<boolean> {
    // Só aceita clínicas que aquela resposta realmente indicou e comprovantes ainda válidos.
    const comment = input.comment ? redactIdentifiers(input.comment).slice(0, 500) : null;
    const result = await this.db.query(
      `INSERT INTO clinic_visit_feedback(response_id,clinic_id,rating,comment)
      SELECT r.response_id,$2::text,$3::int,$4::text FROM response_receipts r
      WHERE r.response_id=$1 AND r.token_hash=$5 AND r.created_at>now()-interval '7 days'
        AND $2::text=ANY(r.clinic_ids)
      ON CONFLICT(response_id,clinic_id) DO UPDATE SET rating=EXCLUDED.rating,
        comment=EXCLUDED.comment,updated_at=now()
      RETURNING response_id`,
      [input.responseId, input.clinicId, input.rating, comment, digest(input.token)],
    );
    return result.rows.length === 1;
  }

  async purgeExpiredReceipts() {
    await this.db.query("DELETE FROM response_receipts WHERE created_at<=now()-interval '7 days'");
  }
}
