import { randomUUID } from 'node:crypto';
import {
  modelAnswerSchema,
  type ChatRequest,
  type ChatResponse,
  type Specialty,
} from '../../shared/contracts.js';
import type { AIProvider, Evidence } from '../ai/provider.js';
import type { CatalogRepository } from '../db/catalog.js';
import { detectUrgency, isUnsafeOutput } from '../domain/safety.js';
import { redactIdentifiers } from '../domain/text.js';
import type { Retriever } from '../rag/retrieve.js';

const notice =
  'O MedFinder ajuda a encontrar atendimento e não substitui avaliação médica. A ausência de alerta não descarta uma urgência.';
const samu = {
  id: 'samu-192',
  title: 'Quando chamar o SAMU 192',
  url: 'https://www.gov.br/saude/pt-br/composicao/saes/samu-192',
  publisher: 'Ministério da Saúde',
  excerpt: 'Orientações públicas sobre acesso ao atendimento de urgência pelo SAMU 192.',
  reviewStatus: 'draft' as const,
};

export function safetyResponse(urgency: 'emergency' | 'prompt'): ChatResponse {
  return {
    id: randomUUID(),
    urgency,
    specialtyIds: [],
    questions: [],
    clinics: [],
    mode: 'safety',
    notice,
    answer:
      urgency === 'emergency'
        ? 'Seu relato contém um possível sinal de emergência. Procure atendimento imediato. No Brasil, ligue para o SAMU 192 e siga as orientações da equipe. Não aguarde indicações de clínicas pelo chat. Se possível, peça ajuda a alguém próximo.'
        : 'Esse relato precisa de avaliação presencial em um serviço de saúde ainda hoje. Procure uma unidade de pronto atendimento. Se houver piora importante, dificuldade para respirar, desmaio ou dor no peito, ligue para o SAMU 192. Não aguarde uma consulta eletiva pelo chat.',
    sources: [samu],
  };
}

function fallback(reason: 'no-evidence' | 'unavailable'): ChatResponse {
  return {
    id: randomUUID(),
    urgency: 'uncertain',
    specialtyIds: [],
    clinics: [],
    sources: [],
    mode: 'fallback',
    notice,
    answer:
      reason === 'no-evidence'
        ? 'Ainda não tenho informações suficientes na base para indicar uma especialidade com fundamento. Você pode procurar uma equipe de atenção primária para uma avaliação inicial. Se os sintomas forem intensos ou estiverem piorando, procure atendimento presencial.'
        : 'Não consegui concluir a consulta à base agora. Tente novamente em instantes. Se precisar de atendimento, procure uma unidade de saúde; não espere a resposta do chat em caso de urgência.',
    questions:
      reason === 'no-evidence'
        ? ['Onde está o desconforto e há quanto tempo começou?', 'Como isso está afetando você?']
        : [],
  };
}

export class ChatService {
  private inFlight = 0;
  constructor(
    private readonly retriever: Retriever,
    private readonly provider: AIProvider,
    private readonly catalog: CatalogRepository,
    private readonly maxConcurrency = 4,
    private readonly reportFailure: () => void = () => {},
  ) {}

  async answer(request: ChatRequest): Promise<ChatResponse> {
    const urgency = detectUrgency([...request.history, request.message]);
    if (urgency) return safetyResponse(urgency);
    if (this.inFlight >= this.maxConcurrency) return fallback('unavailable');
    this.inFlight++;
    try {
      const history = request.history.map(redactIdentifiers);
      const message = redactIdentifiers(request.message);
      // Preserve the original complaint in short follow-up turns without accepting
      // client-supplied assistant instructions or a fabricated system role.
      const evidence = await this.retriever.search([...history.slice(-2), message].join('\n'));
      if (!evidence.length) return fallback('no-evidence');
      const draft = modelAnswerSchema.parse(
        await this.provider.generate({ message, history, evidence }),
      );
      if (draft.urgency === 'emergency' || draft.urgency === 'prompt')
        return safetyResponse(draft.urgency);
      if (draft.urgency === 'uncertain') return fallback('no-evidence');
      const sources = this.validateEvidence(draft.sourceIds, draft.specialtyIds, evidence);
      if (
        !sources ||
        draft.answer.length > 1800 ||
        draft.questions.length > 2 ||
        draft.questions.some((question) => question.length > 220) ||
        isUnsafeOutput([draft.answer, ...draft.questions].join(' '))
      )
        return fallback('no-evidence');
      const results = await this.catalog.search(
        { city: request.city, insurance: request.insurance, specialty: '', page: 1 },
        draft.specialtyIds,
      );
      return {
        id: randomUUID(),
        answer: draft.answer,
        urgency: draft.urgency,
        specialtyIds: [...new Set(draft.specialtyIds)],
        questions: draft.questions,
        sources: sources.map(({ id, title, url, publisher, excerpt, reviewStatus }) => ({
          id,
          title,
          url,
          publisher,
          excerpt,
          reviewStatus,
        })),
        clinics: results.items.slice(0, 3),
        mode: this.provider.mode,
        notice,
      };
    } catch {
      // Do not log SDK errors: they may contain prompts, API keys or health data.
      this.reportFailure();
      return fallback('unavailable');
    } finally {
      this.inFlight--;
    }
  }

  private validateEvidence(ids: string[], specialtyIds: Specialty[], evidence: Evidence[]) {
    if (!ids.length || !specialtyIds.length || specialtyIds.length > 3) return null;
    const sources = evidence.filter((item) => ids.includes(item.id));
    if (ids.some((id) => !sources.some((item) => item.id === id))) return null;
    if (specialtyIds.some((id) => !sources.some((item) => item.specialties.includes(id))))
      return null;
    return sources;
  }
}
