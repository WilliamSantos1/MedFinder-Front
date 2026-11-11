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
import { normalize, redactIdentifiers } from '../domain/text.js';
import { hasUnrecognizedInsurance, resolveInsurances } from '../domain/insurance.js';
import { clearsInsuranceFilter, requestsSpecialtyWithoutClinics } from '../domain/language-intents.js';
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
import { isSupportedReferral, modelCandidateIds } from '../domain/referral-validation.js';
import { selectEvidenceBackedReferral } from '../domain/referral-decision.js';
import { currentReferralEvidence, symptomLedgerFromMessages, updateSymptomLedger } from '../domain/symptom-ledger.js';
import { needsMusculoskeletalIntake } from '../domain/musculoskeletal-interview.js';
import { adaptiveIntakeTopics } from '../domain/adaptive-interview.js';
import { assessAnatomicalDifferential } from '../domain/anatomical-differential.js';
import { retrieveClinicalGuidance } from '../domain/clinical-guidance.js';
import type { Retriever } from '../rag/retrieve.js';
import type { SpecialtyResolver } from './specialty-resolver.js';
import { catalogContext, routeCatalog, type CatalogIntent } from './chat-intent.js';

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
    let activeRequest: ChatRequest = conversation.newEpisode
      ? { ...request, context: undefined }
      : request;

    // 1) Deterministic safety always wins and never waits for an LLM/RAG,
    // but it only evaluates the current clinical episode.
    const urgency = detectUrgency(scopedMessages);
    if (urgency) return safetyResponse(urgency);
    if (scopedMessages.some(possibleMedicationPoisoning)) return medicationPoisoningResponse();
    if (toxicSubstanceAdviceRequest(request.message)) return toxicSubstanceBoundaryResponse();
    if (medicationAdviceRequest(request.message, conversation.history))
      return medicationBoundaryResponse(activeRequest);

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
      if (specialty && (specialty.id !== 'pediatria' ||
          (patientProfile(scopedMessages, conversation.care?.askedTopics.includes('age_group')).ageYears !== null &&
          patientProfile(scopedMessages, conversation.care?.askedTopics.includes('age_group')).ageYears! < 18)))
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

    if (
      specialtyConfirmationRequest(request.message) &&
      activeRequest.context?.specialtyId === 'pediatria' &&
      !conversation.newEpisode
    ) {
      const currentPatient = patientProfile(scopedMessages, conversation.care?.askedTopics.includes('age_group'));
      if (currentPatient.ageYears === null) return this.clarificationResponse(
        activeRequest, conversation.care, ['age_group'], true, scopedMessages.join('\n'),
      );
      if (currentPatient.ageYears >= 18) {
        const general = await this.resolver.byId('clinica-medica');
        if (general) return this.specialtyAnswer(activeRequest, general, scopedMessages, 'uncertain', this.provider.mode, 'fallback');
      }
    }

    // 3) Explicit catalog requests are resolved entirely from the database.
    // A new patient cannot inherit the previous patient's specialty/clinic context.
    const catalogRoute = await routeCatalog(activeRequest, this.catalog, this.resolver);
    if (catalogRoute) return this.catalogAnswer(activeRequest, catalogRoute);

    // Persist symptom status per patient and use ONLY still-active facts to
    // score referrals. A resolved eye complaint must never anchor the next
    // recommendation to Oftalmologia when the remaining issue is nasal.
    const previousSymptoms = activeRequest.context?.symptomState ??
      symptomLedgerFromMessages(conversation.history);
    const symptomState = updateSymptomLedger(previousSymptoms, request.message);
    const currentEvidence = currentReferralEvidence(scopedMessages, symptomState);
    activeRequest = {
      ...activeRequest,
      context: {
        ...(activeRequest.context ?? {
          specialtyId: null, clinicIds: [], city: activeRequest.city,
          insurance: activeRequest.insurance,
        }),
        symptomState,
      },
    };

    // Catalog questions must not count as answers to an open clinical interview.
    // Record only a genuine clinical follow-up after catalog intent was ruled out.
    // Preserve answers to questions within this episode. A simple "não" is
    // evidence only for an associated-signs question that was actually asked.
    const priorCare = conversation.care;
    const reply = normalize(request.message);
    if (priorCare?.questions.length) {
      const isNo = /^(?:nao|nao tenho|nenhum|nenhuma|nada|nenhum deles|nenhuma delas)[.! ]*$/.test(reply);
      // A user may answer two questions in one message: "começou hoje. não".
      // A stand-alone negative after punctuation answers the associated-signs
      // question instead of forcing another identical round of questions.
      const finalStandaloneNo = /(?:^|[.!?;]\s*)(?:nao|nenhum|nenhuma|nada)[.!? ]*$/.test(reply);
      const isYes = /^(?:sim|sim tenho|tenho sim)[.! ]*$/.test(reply);
      const explicitKnown = assessDetail([request.message]).known;
      const responded = priorCare.questions.filter((topic) =>
        explicitKnown.has(topic) || (topic === 'associated_symptoms' && (isNo || finalStandaloneNo)) ||
        (topic === 'age_group' && /^(?:\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)[.! ]*$/.test(reply)),
      );
      const care = {
        ...priorCare,
        answeredTopics: [...new Set([...(priorCare.answeredTopics ?? []), ...responded])],
        interview: [...(priorCare.interview ?? []), {
          topics: priorCare.questions,
          answer: redactIdentifiers(request.message),
        }].slice(-3),
      };
      conversation.care = care;
      if (activeRequest.context) activeRequest = {
        ...activeRequest, context: { ...activeRequest.context, care },
      };

      // The user affirmed at least one warning sign, but did not identify it.
      // Clarify rather than assuming "no symptoms" or offering elective clinics.
      if (isYes && priorCare.questions.includes('associated_symptoms')) {
        if (priorCare.round >= 3) return safetyResponse('prompt');
        const question = /\b(?:costas|coluna|lombar)\b/.test(normalize(scopedMessages.join(' ')))
          ? 'Qual dos sinais você percebeu: fraqueza ou dormência nas pernas, febre, alteração para urinar/evacuar ou outro?'
          : 'Qual dos sintomas associados você percebeu? Descreva qual deles.';
        return {
          ...empty(), status: 'needs_information', urgency: 'uncertain', mode: this.provider.mode,
          answer: 'Preciso saber qual sinal apareceu antes de indicar o atendimento.',
          questions: [question],
          context: { ...activeRequest.context!, care: {
            ...care, round: Math.min(3, care.round + 1),
            questions: ['associated_symptoms'],
          } },
        };
      }
    }


    // A plan written alongside a symptom must filter the clinically selected specialty as well.
    const meta = await this.catalog.metadata();
    const plans = resolveInsurances(request.message, meta.insurances);
    if (
      plans.ambiguous ||
      plans.matches.length > 1 ||
      hasUnrecognizedInsurance(request.message, meta.insurances) ||
      (activeRequest.context?.catalog?.resumeCare &&
        !plans.matches.length &&
        !activeRequest.insurance)
    )
      return {
        ...empty(),
        status: 'needs_information',
        urgency: 'uncertain',
        mode: this.provider.mode,
        answer:
          plans.matches.length > 1
            ? `Identifiquei mais de um convênio possível: ${plans.matches.join(', ')}. Qual deles você quer usar nesta consulta?`
            : 'Não identifiquei esse plano no catálogo. Qual é o nome do convênio? Informe o nome ou selecione uma opção no filtro para continuar o direcionamento.',
        questions: ['Qual convênio você quer consultar?'],
        context: {
          specialtyId: null,
          clinicIds: [],
          city: activeRequest.city,
          insurance: '',
          ...(activeRequest.context?.care ? { care: activeRequest.context.care } : {}),
          catalog: { scope: 'all', clinicIds: [], awaitingInsurance: true, resumeCare: true },
        },
      };
    const mentionedCity = meta.cities.find((city) =>
      ` ${normalize(request.message)} `.includes(` ${normalize(city)} `),
    );
    activeRequest = {
      ...activeRequest,
      city: mentionedCity ?? (activeRequest.city || activeRequest.context?.city || ''),
      insurance: clearsInsuranceFilter(request.message, plans.matches.length > 0)
        ? ''
        : plans.matches.length === 1
          ? plans.matches[0]
          : activeRequest.insurance || activeRequest.context?.insurance || '',
    };

    const patient = patientProfile(
      scopedMessages,
      conversation.care?.askedTopics.includes('age_group'),
    );
    const routing = routeComplaint(scopedMessages, patient, currentEvidence);
    const hasPendingAge = Boolean(patient.needsAge && patient.ageYears === null);

    // A question challenging a previous referral ("não seria mais indicado
    // Ortopedia?") is NOT medication advice or a new symptom. Reassess the
    // ORIGINAL clinical evidence without treating the requested specialty as
    // a symptom. Do not inherit a three-round fallback as a final judgment.
    const referralChallenge =
      /\b(?:nao seria|seria|nao e|acha que|poderia ser|por que nao|porque nao)\b.{0,75}\b(?:indicado|indicada|adequado|adequada|melhor|especialidade|especialista)\b/.test(reply);
    if (
      referralChallenge &&
      !conversation.newEpisode &&
      conversation.history.length > 0 &&
      activeRequest.context?.specialtyId
    ) {
      const mentioned = await this.resolver.mentions(request.message);
      if (mentioned.length === 1) {
        const proposed = mentioned[0];
        const earlierPatient = patientProfile(conversation.history);
        const earlierRouting = routeComplaint(conversation.history, earlierPatient);
        if (isSupportedReferral(proposed.id, earlierRouting, earlierPatient)) {
          const missing = adaptiveIntakeTopics(conversation.history).slice(0, 2);
          if (missing.length) {
            const clarification = this.clarificationResponse(
              activeRequest, undefined, missing, false, conversation.history.join('\n'),
              this.provider.mode,
            );
            clarification.answer =
              `${proposed.name} é uma possibilidade coerente com a queixa relatada, ` +
              'mas preciso diferenciar causas e verificar sinais relevantes antes de priorizar a especialidade.';
            return clarification;
          }
          return this.specialtyAnswer(
            activeRequest, proposed, conversation.history, 'routine', this.provider.mode, 'medium',
          );
        }
        const clarification = this.clarificationResponse(
          activeRequest, undefined, ['associated_symptoms'], false,
          conversation.history.join('\n'), this.provider.mode,
        );
        clarification.answer =
          `Não tenho evidências suficientes no relato para priorizar ${proposed.name}. ` +
          'Vou verificar sinais relevantes antes de reavaliar o encaminhamento.';
        return clarification;
      }
    }

    if (routing.socialOnly && activeRequest.context)
      return {
        ...empty(),
        status: 'ok',
        urgency: 'routine',
        mode: this.provider.mode,
        context: activeRequest.context,
        answer:
          'Certo! Posso continuar com as clínicas indicadas, consultar outro convênio ou ajudar com uma nova queixa.',
      };
    if (routing.socialOnly || !routing.healthComplaint)
      return this.describeComplaintResponse(activeRequest);

    // Never infer a child's age from the caregiver or another episode.
    if (hasPendingAge) return this.clarificationResponse(
      activeRequest, conversation.care, ['age_group'], true, scopedMessages.join('\n'),
    );

    // In Ollama/OpenAI modes, the model interprets every new clinical complaint,
    // including the very first message. The lexical router supplies safety and
    // fallback hints, but never replaces the semantic model on a clear symptom.
    // The offline demo mode deliberately retains its predictable fast-path.
    const semanticFirst = this.provider.mode !== 'demo';

    // 4) Localized pain is NOT a diagnosis. For an under-described back, foot,
    // shoulder, knee, etc. first collect onset, relevant associated signs and
    // what triggered it. The deterministic high-score shortcut must not skip
    // these clinically useful questions.
    const musculoskeletal = needsMusculoskeletalIntake(scopedMessages);
    const intakeTopics = adaptiveIntakeTopics(scopedMessages, conversation.care);
    // Cross-system anatomy is a reason to ask discriminating questions, NOT a
    // reason to silently bypass the semantic model. In Ollama/OpenAI mode the
    // model still interprets the very first complaint; the backend constrains
    // the output and asks required questions before any elective referral.
    // Demo mode keeps its deterministic, offline intake without an LLM.
    const unresolvedAnatomy = assessAnatomicalDifferential(currentEvidence).unresolved;
    if (!semanticFirst && unresolvedAnatomy && intakeTopics.length && (conversation.care?.round ?? 0) < 3) {
      return this.clarificationResponse(
        activeRequest, conversation.care, intakeTopics, false,
        scopedMessages.join('\n'), this.provider.mode,
      );
    }
    if (intakeTopics.length && !semanticFirst)
      return this.clarificationResponse(
        activeRequest,
        conversation.care,
        intakeTopics,
        false,
        scopedMessages.join('\n'),
      );

    // The three-round cap prevents looping; it is NOT a reason by itself
    // to erase a well-supported specialist recommendation. When the patient
    // has answered nothing discriminating ("não sei" repeatedly), retain a
    // cautious general destination without asking the LLM to hallucinate.
    const knownDetails = assessDetail(scopedMessages).known;
    const answeredDetails = new Set(conversation.care?.answeredTopics ?? []);
    const hasTimingOrCause = knownDetails.has('onset_duration') ||
      knownDetails.has('trigger') || answeredDetails.has('onset_duration') ||
      answeredDetails.has('trigger');
    const hasClinicalContext = knownDetails.has('associated_symptoms') ||
      knownDetails.has('pattern') || answeredDetails.has('associated_symptoms') ||
      answeredDetails.has('pattern');
    if ((conversation.care?.round ?? 0) >= 3 && !hasTimingOrCause && !hasClinicalContext) {
      const broad = await this.resolver.byId(broadFallbackId(patient));
      if (broad) {
        const response = await this.specialtyAnswer(
          activeRequest, broad, scopedMessages, 'uncertain', this.provider.mode, 'fallback',
        );
        response.answer = `Ainda faltam informações para indicar com segurança uma especialidade específica. ${response.answer}`;
        return response;
      }
    }

    // Fully described, straightforward complaints can still use fast-path.
    // After an interactive intake, give the semantic model a chance to check
    // the candidate specialty instead of blindly forcing the body-location rule.
    const needsSemanticReview = Boolean(conversation.care?.round) && (
      musculoskeletal || /\b(?:tontura|vertigem|cefaleia|dor de cabeca|dor na barriga|dor abdominal|dor no estomago)\b/.test(
        normalize(scopedMessages.join(' ')),
      )
    );
    if (routing.deterministicId && !needsSemanticReview && !semanticFirst) {
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

    if (topics.length && !semanticFirst)
      return this.clarificationResponse(
        activeRequest,
        conversation.care,
        topics,
        patient.needsAge,
        scopedMessages.join('\n'),
      );

    // 6) The semantic model runs from the first complaint but cannot choose
    // arbitrary specialties whenever the current patient already supplied
    // independent anatomical/symptom evidence. Provide only plausible first
    // referrals and a general entry point. For genuinely unfamiliar terms,
    // permit the model to read the full taxonomy, then validate its output
    // independently before showing any clinic.
    const evidenceIds = modelCandidateIds(routing, patient);
    let specialties = evidenceIds?.length
      ? await this.resolver.listByIds(evidenceIds)
      : await this.resolver.list();
    if (!specialties.length) {
      const general = await this.resolver.byId(broadFallbackId(patient));
      specialties = general ? [general] : [];
    }

    // Pediatria is never a valid default for an unknown-age or adult patient.
    // It cannot be inferred merely from a relative or a previous conversation.
    const requestedPediatrics = /\b(?:pediatra|pediatria)\b/.test(normalize(request.message));
    if (patient.adultReported || (patient.ageYears !== null && patient.ageYears >= 18) || (patient.ageYears === null && !requestedPediatrics)) {
      specialties = specialties.filter((candidate) => candidate.id !== 'pediatria');
    }
    if (!specialties.length) {
      const general = await this.resolver.byId(broadFallbackId(patient));
      if (general) specialties = [general];
    }
    // A careful general/adult intake remains possible even when a body-location
    // rule is strongly weighted; never force a specialty on insufficient evidence.
    if (needsSemanticReview && !specialties.some((candidate) => candidate.id === 'clinica-medica')) {
      const general = await this.resolver.byId('clinica-medica');
      if (general) specialties.push(general);
    }

    // OpenAI is optional and consent-gated only when we are actually about to call it.
    if (this.provider.mode === 'openai' && !request.consent)
      throw Object.assign(new Error('Autorize o envio à OpenAI antes de continuar.'), {
        statusCode: 400,
      });

    // An overloaded local model must not turn a guess from keywords into an
    // apparently model-validated specialist recommendation.
    if (this.inFlight >= this.maxConcurrency)
      return semanticFirst
        ? this.semanticUnavailable(activeRequest, scopedMessages, conversation.care, intakeTopics, topics)
        : this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);

    this.inFlight++;
    try {
      let output: unknown;
      try {
        output = await this.provider.generate({
          message: redactIdentifiers(request.message),
          history: conversation.history.slice(-6).map(redactIdentifiers),
          specialties,
          previousQuestions: (conversation.care?.questions ?? []).map((topic) =>
            questionText(topic, scopedMessages.join('\n')),
          ),
          patient,
          clinicalGuidance: retrieveClinicalGuidance([currentEvidence]),
          navigationHints: routing.candidates.slice(0, 4).map((candidate, index) => ({
            specialtyId: candidate.id,
            reason: candidate.reason.slice(0, 160),
            relativePriority: index === 0 ? 'primary' as const : 'alternative' as const,
          })),
          interview: conversation.care?.interview ?? [],
        });
      } catch {
        this.reportFailure();
        return semanticFirst
          ? this.semanticUnavailable(activeRequest, scopedMessages, conversation.care, intakeTopics, topics)
          : this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);
      }

      const parsed = modelAnswerSchema.safeParse(output);
      if (!parsed.success) {
        this.reportFailure();
        return semanticFirst
          ? this.semanticUnavailable(activeRequest, scopedMessages, conversation.care, intakeTopics, topics)
          : this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);
      }

      const draft = parsed.data;
      if (draft.urgency === 'emergency' || draft.urgency === 'prompt')
        return safetyResponse(draft.urgency);

      // The model selects topics, but the backend controls the text and makes
      // sure sparse musculoskeletal, pelvic and systemic complaints receive a
      // meaningful interview even if a small model prematurely names a specialty.
      const requestedTopics = [...new Set(draft.questions)];
      const known = assessDetail(scopedMessages).known;
      for (const answered of conversation.care?.answeredTopics ?? []) known.add(answered);
      const asked = new Set(conversation.care?.askedTopics ?? []);
      const canAsk = (conversation.care?.round ?? 0) < 3;
      const viable = requestedTopics.filter((topic) => !known.has(topic) && !asked.has(topic));
      const required = [...new Set([
        ...(patient.needsAge ? (['age_group'] as const) : []),
        ...intakeTopics,
        ...topics,
      ])].filter(
        // A user may clarify the body region while accidentally skipping the
        // onset/red-flag questions. Retry the still-unanswered questions ONCE,
        // rather than inventing a specialty after one unrelated reply.
        (topic) => !known.has(topic) && (
          !asked.has(topic) ||
          ((conversation.care?.round ?? 0) < 2 && conversation.care?.questions.includes(topic))
        ),
      );
      if (canAsk && semanticFirst && required.length) {
        // Prefer model-chosen relevant topics when they overlap the safety-aware
        // intake, but do not let the model skip missing essential facts.
        const prioritized = [
          ...viable.filter((topic) => required.includes(topic)),
          ...required,
        ];
        const selected = [...new Set(prioritized)].slice(0, 2);
        return this.clarificationResponse(
          activeRequest,
          conversation.care,
          selected,
          selected.includes('age_group'),
          scopedMessages.join('\n'),
          this.provider.mode,
        );
      }
      // For unfamiliar symptoms with no dictionary match, let the model ask
      // a focused missing question instead of guessing from a body-part word.
      if (canAsk && viable.length && (semanticFirst || !draft.specialty || Boolean(conversation.care?.round))) {
        const selected = viable.slice(0, 2);
        return this.clarificationResponse(
          activeRequest,
          conversation.care,
          selected,
          selected.includes('age_group'),
          scopedMessages.join('\n'),
          this.provider.mode,
        );
      }

      let specialty: Specialty | null = null;
      if (draft.specialty) {
        const match = await this.resolver.resolve(draft.specialty.name);
        const allowedIds = new Set(specialties.map((candidate) => candidate.id));
        if (match.status === 'resolved' && match.specialty && allowedIds.has(match.specialty.id))
          specialty = match.specialty;
      }

      // Mandatory independent referral validation for EVERY confidence level,
      // not just 'high'. A known but unrelated specialty (e.g. Ortopedia for
      // nasal congestion/fever) must never become a list of unrelated clinics.
      // Unknown new symptoms are interpreted by the model, but a specialty
      // without independently supported clinical evidence is not asserted.
      if (specialty && !isSupportedReferral(specialty.id, routing, patient)) {
        specialty = null;
      }

      // A pediatric suggestion cannot override an explicitly adult patient. Recover to the broad
      // adult entry point instead of displaying an invalid model choice.
      if (
        specialty?.id === 'pediatria' &&
        (patient.adultReported || (patient.ageYears !== null && patient.ageYears >= 18) || (patient.ageYears === null && !requestedPediatrics))
      ) specialty = null;

      // Reconcile model output with independently supported, discriminating
      // clinical evidence. Do not let a malformed/off-shortlist model response
      // erase a strongly evidenced referral and force Clínica Médica.
      // Conversely, ambiguous one-word complaints retain broad entry care.
      const decision = selectEvidenceBackedReferral(
        routing,
        patient,
        specialty?.id ?? null,
        assessDetail(scopedMessages).known,
      );
      if (decision.specialtyId !== specialty?.id) {
        specialty = decision.specialtyId
          ? await this.resolver.byId(decision.specialtyId)
          : null;
      }
      if (!specialty) {
        const fallback = await this.resolver.byId(broadFallbackId(patient));
        if (!fallback) return this.describeComplaintResponse(activeRequest, this.provider.mode);
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
      return semanticFirst
        ? this.semanticUnavailable(activeRequest, scopedMessages, conversation.care, intakeTopics, topics)
        : this.fallbackNavigation(activeRequest, scopedMessages, patient, routing.fallbackId);
    } finally {
      this.inFlight--;
    }
  }

  /** An offline or malformed model is not evidence for any specific specialty. */
  private semanticUnavailable(
    request: ChatRequest,
    messages: string[],
    previous: NonNullable<ChatRequest['context']>['care'] | undefined,
    intake: Parameters<typeof questionText>[0][],
    topics: Parameters<typeof questionText>[0][],
  ): ChatResponse {
    const assessment = assessDetail(messages);
    const missing = [...new Set([...intake, ...topics, ...assessment.missing])]
      .filter((topic) => !assessment.known.has(topic));
    const response = this.clarificationResponse(
      request, previous, missing.slice(0, 2), false, messages.join('\n'), 'fallback',
    );
    return {
      ...response,
      status: 'llm_unavailable',
      answer: 'A IA local está indisponível neste momento. Não vou indicar uma especialidade específica sem analisar o relato. Confira se o Ollama e o modelo estão ativos; você pode complementar os sintomas abaixo enquanto isso.',
      questions: response.questions.length ? response.questions : [
        'Há quanto tempo começou e quais outros sintomas ou limitações você percebeu?',
      ],
    };
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
        ...(request.context?.symptomState ? { symptomState: request.context.symptomState } : {}),
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
      answer: previous?.questions.some((topic) => topics.includes(topic))
        ? 'Entendi o que você acrescentou. Para sugerir o encaminhamento inicial sem adivinhar, ainda preciso das informações abaixo.'
        : needsAge
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
        ...(request.context?.symptomState ? { symptomState: request.context.symptomState } : {}),
        care: {
          questions: topics,
          askedTopics: [...new Set([...(previous?.askedTopics ?? []), ...topics])],
          round: Math.min(3, (previous?.round ?? 0) + 1),
          ...(previous?.answeredTopics ? { answeredTopics: previous.answeredTopics } : {}),
          ...(previous?.interview ? { interview: previous.interview } : {}),
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
    // Respect an explicit correction such as "nenhuma clínica, só quero a
    // especialidade". Never respond with unrelated generic catalog cards.
    if (requestsSpecialtyWithoutClinics(request.message)) {
      response.context = {
        specialtyId: specialty.id,
        clinicIds: [],
        city: request.city,
        insurance: request.insurance,
        ...(request.context?.care ? { care: { ...request.context.care, questions: [] } } : {}),
        ...(request.context?.symptomState ? { symptomState: request.context.symptomState } : {}),
      };
      return response;
    }
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
      return {
        ...base,
        status: 'needs_information',
        specialty: null,
        answer: route.clarification,
        context: catalogContext(route, request.context),
      };
    const response = await this.findClinics(
      request,
      base,
      route.specialty,
      route.city,
      route.insurance,
      route.clinicIds,
    );
    const visibleIds = response.clinics.map((clinic) => clinic.id);
    const context = catalogContext(route, request.context);
    response.context = {
      ...context,
      clinicIds: visibleIds,
      catalog: {
        ...context.catalog!,
        // New global/named searches establish a new group. Follow-up filters
        // keep the original group even if only one (or zero) clinics matched.
        selectionIds: route.scope === 'selection'
          ? (route.selectionIds ?? route.clinicIds ?? [])
          : visibleIds,
        resultIds: visibleIds,
      },
    };
    if (route.insuranceQuery && route.insurance) {
      const scope = route.scope === 'selection' ? 'Entre as clínicas selecionadas' : 'No catálogo';
      response.answer = response.clinics.length
        ? `${scope}, encontrei ${response.clinics.map((clinic) => clinic.name).join('; ')} com ${route.insurance} entre os convênios cadastrados. Confirme a cobertura do seu produto e do procedimento diretamente com a unidade.`
        : `${scope}, não encontrei uma unidade com ${route.insurance} registrado que corresponda aos filtros informados. A ausência no cadastro não confirma que a clínica não aceita esse plano. Confirme diretamente com a unidade. Os filtros não foram relaxados automaticamente.`;
      if (route.scope === 'selection' && route.clinicIds?.length) {
        const selection = await this.catalog.search(
          { city: route.city, insurance: '', specialty: route.specialty?.id ?? '', page: 1 },
          undefined,
          route.clinicIds,
        );
        const unconfirmed = selection.items.filter(
          (clinic) =>
            !clinic.insurances.some((plan) => normalize(plan) === normalize(route.insurance)),
        );
        if (unconfirmed.length)
          response.answer += ` Não há registro desse convênio em: ${unconfirmed.map((clinic) => clinic.name).join('; ')}.`;
      }
    }
    if (route.nearest && !request.location)
      response.questions = [
        'Ative “Usar minha localização” e repita a pergunta para ordenar por distância.',
      ];
    if (route.intent === 'clinic_information' && response.clinics.length) {
      response.answer = route.insuranceOverview
        ? response.clinics
            .map(
              (clinic) =>
                `${clinic.name}: ${
                  clinic.insurances.length
                    ? `convênios cadastrados: ${clinic.insurances.join(', ')}.`
                    : 'convênios não informados no cadastro; confirme diretamente com a unidade.'
                }`,
            )
            .join('\n')
        : route.detailsUnavailable
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
        // A new clinical navigation answer starts a new comparison set.
        // This prevents the first insurer filter from erasing earlier cards.
        catalog: {
          scope: 'selection',
          clinicIds: clinics.map((clinic) => clinic.id),
          selectionIds: clinics.map((clinic) => clinic.id),
          resultIds: clinics.map((clinic) => clinic.id),
          awaitingInsurance: false,
        },
        ...(request.context?.care ? { care: {
          ...request.context.care,
          questions: [],
        } } : {}),
        ...(request.context?.symptomState ? { symptomState: request.context.symptomState } : {}),
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
    // Catalog facts already come from SQL. Do not send these questions to an embedding model.
    if (base.mode === 'catalog' || (this.provider.mode === 'openai' && !request.consent))
      return response;
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
