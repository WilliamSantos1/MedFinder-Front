import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import {
  modelAnswerSchema,
  type ChatRequest,
  type ChatResponse,
  type Specialty,
} from '../../shared/contracts.js';
import type { AIProvider } from '../ai/provider.js';
import type { CatalogRepository } from '../db/catalog.js';
import { detectUrgency, isUnsafeOutput, containsCatalogClaim } from '../domain/safety.js';
import { redactIdentifiers } from '../domain/text.js';
import { patientProfile } from '../domain/patient.js';
import { careExplanation, earObjectConcern } from '../domain/care-explanation.js';
import {
  assessDetail,
  careConversation,
  clarificationQuestions,
  questionText,
} from '../domain/clarification.js';
import type { Retriever } from '../rag/retrieve.js';
import type { SpecialtyResolver } from './specialty-resolver.js';
import { routeCatalog, type CatalogIntent } from './chat-intent.js';

const notice =
  'O MedFinder ajuda a encontrar atendimento e não substitui avaliação médica. A ausência de alerta não descarta uma urgência.';
const empty = () => ({
  id: randomUUID(),
  specialty: null,
  intent: 'care_navigation' as const,
  context: null,
  questions: [],
  clinics: [],
  sources: [],
  notice,
  ragStatus: 'skipped' as const,
  locationUsed: false,
  feedback: null,
});

export function safetyResponse(urgency: 'emergency' | 'prompt'): ChatResponse {
  return {
    ...empty(),
    urgency,
    mode: 'safety',
    status: 'ok',
    answer:
      urgency === 'emergency'
        ? 'Seu relato contém um possível sinal de emergência. Procure atendimento imediato. No Brasil, ligue para o SAMU 192 e siga as orientações da equipe. Não aguarde indicações de clínicas pelo chat. Se possível, peça ajuda a alguém próximo.'
        : 'Esse relato precisa de avaliação presencial em um serviço de saúde ainda hoje. Procure uma unidade de pronto atendimento. Se houver piora importante, dificuldade para respirar, desmaio ou dor no peito, ligue para o SAMU 192. Não aguarde uma consulta eletiva pelo chat.',
    sources: [
      {
        id: 'samu-192',
        title: 'Quando chamar o SAMU 192',
        url: 'https://www.gov.br/saude/pt-br/composicao/saes/samu-192',
        publisher: 'Ministério da Saúde',
        excerpt: 'Orientações públicas sobre acesso ao atendimento de urgência pelo SAMU 192.',
        isDemo: false,
      },
    ],
  };
}
function fallback(status: 'llm_unavailable' | 'invalid_output'): ChatResponse {
  return {
    ...empty(),
    urgency: 'uncertain',
    mode: 'fallback',
    status,
    answer:
      status === 'llm_unavailable'
        ? 'A IA está indisponível neste momento. Tente novamente em instantes. O catálogo continua disponível para consulta. Em caso de urgência, procure atendimento presencial sem esperar pelo chat.'
        : 'Não foi possível validar a orientação gerada. Tente descrever o desconforto de outra forma ou procure avaliação presencial. Em caso de urgência, não espere pelo chat.',
  };
}
export class ChatService {
  private inFlight = 0;
  constructor(
    private readonly retriever: Retriever,
    private readonly provider: AIProvider,
    private readonly catalog: CatalogRepository,
    private readonly resolver: SpecialtyResolver,
    private readonly maxConcurrency = 4,
    private readonly reportFailure: () => void = () => {},
  ) {}

  async answer(request: ChatRequest): Promise<ChatResponse> {
    const urgency = detectUrgency([...request.history, request.message]);
    if (urgency) return safetyResponse(urgency);
    if (earObjectConcern([...request.history, request.message])) {
      const explanation = careExplanation([...request.history, request.message]);
      const specialty = await this.resolver.byId('otorrinolaringologia');
      return {
        ...safetyResponse('prompt'),
        answer: `${explanation.text} Procure avaliação presencial ainda hoje, sem esperar uma consulta eletiva. Não introduza outros objetos no ouvido.`,
        specialty: specialty
          ? {
              ...specialty,
              reason:
                'Área relacionada à avaliação do ouvido. A prioridade é o atendimento presencial hoje.',
            }
          : null,
        sources: explanation.sources,
      };
    }
    const route = await routeCatalog(request, this.catalog, this.resolver);
    if (route) return this.catalogAnswer(request, route);
    const conversation = careConversation(request);
    const assessment = assessDetail([...conversation.history, request.message]);
    const patient = patientProfile(
      [...conversation.history, request.message],
      conversation.care?.questions.includes('age_group'),
    );
    if (patient.ageYears !== null || patient.adultReported) assessment.known.add('age_group');
    if (this.provider.mode === 'openai' && !request.consent)
      throw Object.assign(new Error('Autorize o envio à OpenAI antes de continuar.'), {
        statusCode: 400,
      });
    if (this.inFlight >= this.maxConcurrency) return fallback('llm_unavailable');
    this.inFlight++;
    try {
      let output: unknown;
      try {
        // No coordinates, client context, filters or catalog facts enter the LLM.
        output = await this.provider.generate({
          message: redactIdentifiers(request.message),
          history: conversation.history.map(redactIdentifiers),
          specialties: await this.resolver.list(),
          previousQuestions: (conversation.care?.questions ?? []).map((topic) =>
            questionText(topic, assessDetail(conversation.history).text),
          ),
          patient,
        });
      } catch (error) {
        this.reportFailure();
        return fallback(
          error instanceof ZodError || error instanceof SyntaxError
            ? 'invalid_output'
            : 'llm_unavailable',
        );
      }
      const parsed = modelAnswerSchema.safeParse(output);
      if (!parsed.success) return fallback('invalid_output');
      const draft = parsed.data;
      if (draft.urgency === 'emergency' || draft.urgency === 'prompt')
        return safetyResponse(draft.urgency);
      const generated = [
        draft.answer,
        ...draft.questions,
        draft.specialty?.name,
        draft.specialty?.reason,
      ]
        .filter(Boolean)
        .join(' ');
      if (isUnsafeOutput(generated) || containsCatalogClaim(generated))
        return fallback('invalid_output');
      const base: ChatResponse = {
        ...empty(),
        status: 'needs_information',
        urgency: 'uncertain',
        mode: this.provider.mode,
        answer:
          'Ainda não consegui determinar uma especialidade com segurança a partir desse relato.',
      };
      const needsAge =
        patient.needsAge ||
        (/^pediatr/i.test(draft.specialty?.name ?? '') && !assessment.known.has('age_group'));
      if (assessment.generic || needsAge || !draft.specialty) {
        const relevant = assessment.generic
          ? draft.questions.filter(
              (topic) => topic !== 'age_group' || !assessment.known.has('age_group'),
            )
          : [];
        const topics =
          assessment.generic || needsAge
            ? clarificationQuestions(
                {
                  ...assessment,
                  missing: needsAge ? ['age_group', ...assessment.missing] : assessment.missing,
                },
                relevant,
                conversation.care,
              )
            : [];
        return {
          ...base,
          answer: topics.length
            ? needsAge
              ? 'A idade de quem está com o sintoma pode mudar a indicação de atendimento. Preciso confirmar essa informação antes de recomendar uma especialidade.'
              : 'Antes de sugerir uma especialidade, preciso esclarecer alguns detalhes sobre o desconforto.'
            : 'Não consegui validar uma recomendação de especialidade a partir desse relato. Procure avaliação presencial para definir o atendimento adequado; não espere pelo chat se houver piora ou sinais de urgência.',
          questions: topics.map((topic) => questionText(topic, assessment.text)),
          context: {
            specialtyId: null,
            clinicIds: [],
            city: request.city,
            insurance: request.insurance,
            care: {
              questions: topics,
              askedTopics: [...new Set([...(conversation.care?.askedTopics ?? []), ...topics])],
              round: Math.min(3, (conversation.care?.round ?? 0) + 1),
            },
          },
        };
      }
      const match = await this.resolver.resolve(draft.specialty.name);
      if (match.status !== 'resolved' || !match.specialty)
        return {
          ...base,
          status:
            match.status === 'not_registered'
              ? 'specialty_not_registered'
              : 'specialty_unrecognized',
        };
      if (match.specialty.id === 'pediatria' && patient.adultReported)
        return fallback('invalid_output');
      // Model prose is never published: it can contain aliases, additional specialties or invented names.
      // The LLM supplies the candidate and urgency; presentation uses the resolved entity only.
      const explanation = careExplanation(
        [...conversation.history, request.message],
        match.specialty,
      );
      const response: ChatResponse = {
        ...base,
        questions: [],
        status: 'ok',
        urgency: draft.urgency,
        answer: `${this.provider.mode === 'demo' ? 'Exemplo demonstrativo, sem avaliação clínica. ' : ''}${explanation.text}`,
        sources: explanation.sources,
        specialty: {
          ...match.specialty,
          reason:
            match.specialty.id === 'pediatria'
              ? 'Área sugerida para avaliação inicial considerando a idade informada e o relato. Confirme a faixa etária atendida pela unidade.'
              : 'Área sugerida para avaliação do relato, sem estabelecer um diagnóstico.',
        },
      };
      return this.findClinics(request, response, match.specialty, request.city, request.insurance);
    } finally {
      this.inFlight--;
    }
  }

  private async catalogAnswer(request: ChatRequest, route: CatalogIntent): Promise<ChatResponse> {
    const base: ChatResponse = {
      ...empty(),
      intent: route.intent,
      urgency: 'routine',
      mode: 'catalog',
      status: 'ok',
      specialty: route.specialty,
      answer:
        'Consulte os dados publicados nas fontes de cada unidade. Confirme cobertura e disponibilidade diretamente com a clínica.',
    };
    if (route.clarification)
      return { ...base, status: 'needs_information', specialty: null, answer: route.clarification };
    const response = await this.findClinics(
      request,
      base,
      route.specialty,
      route.city,
      route.insurance,
      route.clinicIds,
    );
    if (route.nearest && !request.location)
      response.questions = [
        'Ative “Usar minha localização” e repita a pergunta para ordenar por distância.',
      ];
    if (route.intent === 'clinic_information' && response.clinics.length) {
      response.answer = route.detailsUnavailable
        ? 'Horários, preços e vagas não são confirmados pelo MedFinder. Consulte o contato e os textos da fonte oficial da unidade abaixo.'
        : response.clinics
            .map(
              (clinic) =>
                `${clinic.name}: ${clinic.address}, ${clinic.neighborhood ? clinic.neighborhood + ', ' : ''}${clinic.city}${clinic.state ? ' — ' + clinic.state : ''}.`,
            )
            .join('\n');
    }
    return response;
  }

  private async findClinics(
    request: ChatRequest,
    base: ChatResponse,
    specialty: Specialty | null,
    city: string,
    insurance: string,
    clinicIds?: string[],
  ): Promise<ChatResponse> {
    const results = await this.catalog.search(
      { city, insurance, specialty: specialty?.id ?? '', page: 1, location: request.location },
      undefined,
      clinicIds,
    );
    const clinics = results.items.slice(0, 3);
    const response: ChatResponse = {
      ...base,
      clinics,
      locationUsed: Boolean(request.location),
      status: clinics.length ? 'ok' : 'no_matching_clinics',
      context: {
        specialtyId: specialty?.id ?? null,
        clinicIds: clinics.map((c) => c.id),
        city,
        insurance,
      },
    };
    if (!clinics.length || (this.provider.mode === 'openai' && !request.consent)) return response;
    try {
      // Enrichment is restricted to selected IDs; geolocation stays out of the query.
      const rag = await this.retriever.search(
        [redactIdentifiers(request.message), specialty?.name].filter(Boolean).join('\n'),
        clinics.map((c) => c.id),
      );
      return { ...response, sources: [...response.sources, ...rag.sources], ragStatus: rag.status };
    } catch {
      return { ...response, ragStatus: 'unavailable' };
    }
  }
}
