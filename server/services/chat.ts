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
import { detectUrgency } from '../domain/safety.js';
import { redactIdentifiers } from '../domain/text.js';
import { patientProfile } from '../domain/patient.js';
import { careExplanation, earObjectConcern } from '../domain/care-explanation.js';
import {
  assessDetail,
  careConversation,
  clarificationQuestions,
  questionText,
} from '../domain/clarification.js';
import {
  medicationAdviceRequest,
  possibleMedicationPoisoning,
  specialtyConfirmationRequest,
  toxicSubstanceAdviceRequest,
} from '../domain/guardrails.js';
import { broadFallbackId, routeComplaint } from '../domain/specialty-routing.js';
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

function medicationPoisoningResponse(): ChatResponse {
  return {
    ...empty(),
    urgency: 'emergency',
    mode: 'safety',
    status: 'ok',
    answer:
      'Há possibilidade de uso excessivo ou acidental de medicamento. Procure orientação imediata: ligue para o Disque-Intoxicação 0800 722 6001. Se houver sonolência intensa, desmaio, confusão, convulsão ou dificuldade para respirar, ligue para o SAMU 192. Não espere uma resposta do chat.',
    sources: [
      {
        id: 'anvisa-disque-intoxicacao',
        title: 'Disque-Intoxicação',
        url: 'https://www.gov.br/anvisa/pt-br/assuntos/agrotoxicos/disque-intoxicacao',
        publisher: 'Anvisa',
        excerpt:
          'O Disque-Intoxicação 0800 722 6001 oferece orientação gratuita sobre intoxicações por medicamentos e outros agentes.',
        isDemo: false,
      },
      {
        id: 'samu-192',
        title: 'Quando chamar o SAMU 192',
        url: 'https://www.gov.br/saude/pt-br/composicao/saes/samu-192',
        publisher: 'Ministério da Saúde',
        excerpt: 'O SAMU 192 atende situações de urgência e emergência.',
        isDemo: false,
      },
    ],
  };
}

function toxicSubstanceBoundaryResponse(): ChatResponse {
  return {
    ...empty(),
    urgency: 'uncertain',
    mode: 'safety',
    status: 'ok',
    answer:
      'Não ingira nem use produtos de limpeza, solventes, combustíveis ou venenos como tratamento. Se já houve ingestão ou exposição relevante, ligue para o Disque-Intoxicação 0800 722 6001 para orientação imediata. Se houver desmaio, convulsão, confusão importante ou dificuldade para respirar, ligue para o SAMU 192.',
    sources: [
      {
        id: 'anvisa-disque-intoxicacao',
        title: 'Disque-Intoxicação',
        url: 'https://www.gov.br/anvisa/pt-br/assuntos/agrotoxicos/disque-intoxicacao',
        publisher: 'Anvisa',
        excerpt:
          'O Disque-Intoxicação 0800 722 6001 oferece orientação gratuita sobre exposições a medicamentos e outros agentes tóxicos.',
        isDemo: false,
      },
    ],
  };
}

function medicationBoundaryResponse(request: ChatRequest): ChatResponse {
  return {
    ...empty(),
    urgency: 'uncertain',
    mode: 'safety',
    status: 'ok',
    context: request.context ?? null,
    answer:
      '⚠️ Atenção sobre medicamentos: o MedFinder não recomenda, confirma, prescreve, compara, ajusta doses ou horários e não informa se um medicamento vai resolver um sintoma. Não tome, dê, aplique ou use medicamentos por orientação do aplicativo. Se um profissional prescreveu esse medicamento especificamente para essa pessoa, siga a prescrição exatamente como foi orientada e confirme dúvidas com o profissional que prescreveu ou com um farmacêutico; o MedFinder não valida nem altera prescrições. Aqui, o foco permanece nos sintomas para indicar a especialidade e as clínicas adequadas. Se houve uso excessivo, reação importante ou piora do quadro, procure atendimento.',
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
    // Scope the clinical episode BEFORE safety, routing, confirmation or RAG.
    // A new person must never inherit symptoms, urgency or specialty from the previous patient.
    const conversation = careConversation(request);
    const scopedMessages = [...conversation.history, request.message];
    const activeRequest: ChatRequest = conversation.newEpisode
      ? { ...request, context: undefined }
      : request;

    // 1) Deterministic safety always wins and never waits for an LLM/RAG,
    // but it only evaluates the current clinical episode.
    const urgency = detectUrgency(scopedMessages);
    if (urgency) return safetyResponse(urgency);
    if (possibleMedicationPoisoning(request.message)) return medicationPoisoningResponse();
    if (toxicSubstanceAdviceRequest(request.message)) return toxicSubstanceBoundaryResponse();
    if (medicationAdviceRequest(request.message)) return medicationBoundaryResponse(activeRequest);

    if (earObjectConcern(scopedMessages)) {
      const explanation = careExplanation(scopedMessages);
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

    // 2) Conversational confirmation reuses a specialty only inside the SAME clinical episode.
    if (
      !conversation.newEpisode &&
      specialtyConfirmationRequest(request.message) &&
      activeRequest.context?.specialtyId
    ) {
      const specialty = await this.resolver.byId(activeRequest.context.specialtyId);
      if (specialty)
        return {
          ...empty(),
          urgency: 'routine',
          mode: this.provider.mode,
          status: 'ok',
          context: activeRequest.context ?? null,
          specialty: {
            ...specialty,
            reason:
              'A área continua sendo a sugestão de navegação com base no relato já informado; isso não confirma um diagnóstico.',
          },
          answer: `Com base nas informações já fornecidas, ${specialty.name} continua sendo a área sugerida para avaliação. A confirmação da causa depende de uma avaliação profissional presencial.`,
        };
    }

    // 3) Explicit catalog requests are resolved entirely from the database.
    // A new patient cannot inherit the previous patient's specialty/clinic context.
    const catalogRoute = await routeCatalog(activeRequest, this.catalog, this.resolver);
    if (catalogRoute) return this.catalogAnswer(activeRequest, catalogRoute);

    const patient = patientProfile(
      scopedMessages,
      conversation.care?.questions.includes('age_group'),
    );
    const routing = routeComplaint(scopedMessages, patient);

    if (routing.socialOnly || !routing.healthComplaint)
      return this.describeComplaintResponse(activeRequest);

    // 4) High-confidence common complaints stay on the instant path.
    // We only ask follow-up questions when they can actually change an ambiguous route.
    if (routing.deterministicId) {
      const specialty = await this.resolver.byId(routing.deterministicId);
      if (specialty)
        return this.specialtyAnswer(
          activeRequest,
          specialty,
          scopedMessages,
          'routine',
          this.provider.mode,
          routing.confidence,
        );
    }

    // 5) Truly underspecified complaints use the router's discriminating question.
    // Medium-confidence overlap (for example dizziness) gets a short interview of at most
    // two useful questions. If the user answers only one, the other may be retried once.
    const assessment = assessDetail(scopedMessages);
    const requestedTopics = routing.needsClarification
      ? routing.clarificationTopics
      : routing.confidence === 'medium' && routing.candidates.length > 1
        ? (['onset_duration', 'associated_symptoms'] as const)
        : [];
    const topics = requestedTopics.length
      ? clarificationQuestions(assessment, [...requestedTopics], conversation.care)
      : [];

    if (topics.length)
      return this.clarificationResponse(
        activeRequest,
        conversation.care,
        topics,
        patient.needsAge,
        scopedMessages.join('\n'),
      );

    // 6) Ambiguity goes to the semantic model with a SHORTLIST, not the whole taxonomy.
    // Unknown free text gets the full active taxonomy as a last semantic attempt.
    const candidateIds = [
      ...routing.candidates.map((candidate) => candidate.id),
      routing.fallbackId,
    ];
    let specialties = routing.candidates.length
      ? await this.resolver.listByIds(candidateIds)
      : await this.resolver.list();
    if (!specialties.length) specialties = await this.resolver.list();

    // OpenAI is optional and consent-gated only when we are actually about to call it.
    if (this.provider.mode === 'openai' && !request.consent)
      throw Object.assign(new Error('Autorize o envio à OpenAI antes de continuar.'), {
        statusCode: 400,
      });

    if (this.inFlight >= this.maxConcurrency)
      return this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);

    this.inFlight++;
    try {
      let output: unknown;
      try {
        output = await this.provider.generate({
          message: redactIdentifiers(request.message),
          history: conversation.history.map(redactIdentifiers),
          specialties,
          previousQuestions: (conversation.care?.questions ?? []).map((topic) =>
            questionText(topic, scopedMessages.join('\n')),
          ),
          patient,
        });
      } catch {
        this.reportFailure();
        return this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);
      }

      const parsed = modelAnswerSchema.safeParse(output);
      if (!parsed.success) {
        this.reportFailure();
        return this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);
      }

      const draft = parsed.data;
      if (draft.urgency === 'emergency' || draft.urgency === 'prompt')
        return safetyResponse(draft.urgency);

      // If the semantic model still asks for a genuinely useful missing detail, respect at most one
      // new backend-owned question. Never loop into a long questionnaire.
      const requestedTopics = draft.questions.filter(
        (topic, index, topics) => topics.indexOf(topic) === index,
      );
      const asked = new Set(conversation.care?.askedTopics ?? []);
      const newTopics = requestedTopics.filter((topic) => !asked.has(topic)).slice(0, 1);
      const canAskOneMore =
        (conversation.care?.round ?? 0) < 3 && asked.size < 3;
      if (!draft.specialty && newTopics.length && canAskOneMore)
        return this.clarificationResponse(
          activeRequest,
          conversation.care,
          newTopics,
          newTopics.includes('age_group'),
          scopedMessages.join('\n'),
          this.provider.mode,
        );

      let specialty: Specialty | null = null;
      if (draft.specialty) {
        const match = await this.resolver.resolve(draft.specialty.name);
        const allowedIds = new Set(specialties.map((candidate) => candidate.id));
        if (
          match.status === 'resolved' &&
          match.specialty &&
          allowedIds.has(match.specialty.id)
        )
          specialty = match.specialty;
      }

      // A pediatric suggestion cannot override an explicitly adult patient. Recover to the broad
      // adult entry point instead of displaying an invalid model choice.
      if (specialty?.id === 'pediatria' && patient.adultReported) specialty = null;

      if (!specialty) {
        const fallback =
          (await this.resolver.byId(routing.fallbackId)) ??
          (await this.resolver.byId(broadFallbackId(patient)));
        if (!fallback)
          return this.describeComplaintResponse(activeRequest, this.provider.mode);
        specialty = fallback;
      }

      return this.specialtyAnswer(
        activeRequest,
        specialty,
        scopedMessages,
        draft.urgency === 'uncertain' ? 'routine' : draft.urgency,
        this.provider.mode,
        routing.confidence,
      );
    } catch (error) {
      // Schema/JSON errors from provider adapters are contained and converted to navigation.
      if (error instanceof ZodError || error instanceof SyntaxError) this.reportFailure();
      return this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);
    } finally {
      this.inFlight--;
    }
  }

  private describeComplaintResponse(
    request: ChatRequest,
    mode: ChatResponse['mode'] = this.provider.mode,
  ): ChatResponse {
    return {
      ...empty(),
      status: 'needs_information',
      urgency: 'uncertain',
      mode,
      answer:
        'Posso ajudar a direcionar o atendimento. Descreva o principal sintoma ou problema de saúde e, se possível, a parte do corpo afetada.',
      questions: [
        'Qual é o principal sintoma ou problema de saúde e em qual parte do corpo ele acontece?',
      ],
      context: {
        specialtyId: null,
        clinicIds: [],
        city: request.city,
        insurance: request.insurance,
      },
    };
  }

  private clarificationResponse(
    request: ChatRequest,
    previous: NonNullable<ChatRequest['context']>['care'] | undefined,
    topics: Parameters<typeof questionText>[0][],
    needsAge: boolean,
    text: string,
    mode: ChatResponse['mode'] = this.provider.mode,
  ): ChatResponse {
    return {
      ...empty(),
      status: 'needs_information',
      urgency: 'uncertain',
      mode,
      answer: needsAge
        ? 'A idade de quem está com o sintoma pode mudar a indicação de atendimento. Preciso confirmar essa informação antes de recomendar uma especialidade.'
        : topics.length > 1
          ? 'Antes de indicar a especialidade, preciso de mais algumas informações curtas para direcionar melhor o atendimento.'
          : 'Preciso de só mais uma informação para direcionar melhor a especialidade.',
      questions: topics.map((topic) => questionText(topic, text)),
      context: {
        specialtyId: null,
        clinicIds: [],
        city: request.city,
        insurance: request.insurance,
        care: {
          questions: topics,
          askedTopics: [...new Set([...(previous?.askedTopics ?? []), ...topics])],
          round: Math.min(3, (previous?.round ?? 0) + 1),
        },
      },
    };
  }

  private async fallbackNavigation(
    request: ChatRequest,
    scopedMessages: string[],
    patient: ReturnType<typeof patientProfile>,
    preferredId: string,
  ): Promise<ChatResponse> {
    const specialty =
      (await this.resolver.byId(preferredId)) ??
      (await this.resolver.byId(broadFallbackId(patient)));
    if (!specialty) return this.describeComplaintResponse(request, 'fallback');
    return this.specialtyAnswer(
      request,
      specialty,
      scopedMessages,
      'uncertain',
      'fallback',
      'fallback',
    );
  }

  private async specialtyAnswer(
    request: ChatRequest,
    specialty: Specialty,
    messages: string[],
    urgency: ChatResponse['urgency'],
    mode: ChatResponse['mode'],
    confidence: 'high' | 'medium' | 'fallback',
  ): Promise<ChatResponse> {
    const explanation = careExplanation(messages, specialty);
    const isBroad = confidence === 'fallback' || specialty.id === 'clinica-medica';
    const response: ChatResponse = {
      ...empty(),
      status: 'ok',
      urgency,
      mode,
      answer: `${mode === 'demo' ? 'Exemplo demonstrativo, sem avaliação clínica. ' : ''}${explanation.text}`,
      sources: explanation.sources,
      specialty: {
        ...specialty,
        reason:
          specialty.id === 'pediatria'
            ? 'Área sugerida para avaliação inicial considerando a idade informada e o relato. Confirme a faixa etária atendida pela unidade.'
            : isBroad
              ? 'Área de entrada ampla sugerida quando o relato não aponta com segurança para uma única especialidade mais específica.'
              : 'Área associada ao tipo e/ou local da queixa relatada, sem estabelecer um diagnóstico.',
      },
    };
    return this.findClinics(request, response, specialty, request.city, request.insurance);
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
        clinicIds: clinics.map((clinic) => clinic.id),
        city,
        insurance,
      },
    };
    if (!clinics.length) {
      const filters = [city && `cidade ${city}`, insurance && `convênio ${insurance}`]
        .filter(Boolean)
        .join(' e ');
      response.answer = specialty
        ? `A área sugerida é ${specialty.name}, mas não encontrei no catálogo uma clínica cadastrada que combine essa especialidade${filters ? ` com ${filters}` : ''}. Os filtros não foram relaxados automaticamente. Você pode remover ou alterar um filtro para ampliar a busca.`
        : `Não encontrei no catálogo uma clínica que combine os filtros informados${filters ? ` (${filters})` : ''}. Os filtros não foram relaxados automaticamente.`;
      response.questions = [
        'Você pode alterar a cidade ou o convênio nos filtros e repetir a busca, se desejar.',
      ];
      return response;
    }
    if (this.provider.mode === 'openai' && !request.consent) return response;
    try {
      // RAG enriches ONLY clinic IDs already selected by SQL filters; it never chooses specialty.
      const rag = await this.retriever.search(
        [redactIdentifiers(request.message), specialty?.name].filter(Boolean).join('\n'),
        clinics.map((clinic) => clinic.id),
      );
      return { ...response, sources: [...response.sources, ...rag.sources], ragStatus: rag.status };
    } catch {
      return { ...response, ragStatus: 'unavailable' };
    }
  }
}
