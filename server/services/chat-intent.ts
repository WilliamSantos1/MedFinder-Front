import type { ChatContext, ChatRequest, Specialty } from '../../shared/contracts.js';
import { normalize } from '../domain/text.js';
import { hasUnrecognizedInsurance, resolveInsurances } from '../domain/insurance.js';
import type { CatalogRepository } from '../db/catalog.js';
import type { SpecialtyResolver } from './specialty-resolver.js';
import {
  clearsInsuranceFilter,
  hasCatalogInformationRequest,
  hasCatalogNoun,
  hasInsuranceRequest,
  hasProximityRequest,
  referencesPreviousClinics,
  requestsEntireCatalog,
  referencedClinicPosition,
  requestsClinicalSpecialty,
} from '../domain/language-intents.js';

const hasTerm = (text: string, term: string) =>
  ` ${text.replace(/[^a-z0-9]+/g, ' ')} `.includes(
    ` ${normalize(term).replace(/[^a-z0-9]+/g, ' ')} `,
  );
const healthSignals =
  /\b(dor|dores|doi|doendo|febre|sangramento|vomit\w*|enjoo|coceira|cocando|desconforto|falta de ar|tontura|vertigem|sintomas?|ansiedade|depressao|insonia|ardencia|irritacao|vermelh\w*|coriza|rinite|congestao|espirros?|tosse|secrecao|nausea|diarreia|inchaco|refluxo|azia|gastrite|enxaqueca|cefaleia|palpitacao|palpitacoes|urinar|urina|bexiga|pele|olho|olhos|ouvido|ouvidos|joelho|ombro|pescoco|coluna|estomago|abdomen|barriga)\b/;

export interface CatalogIntent {
  intent: 'clinic_search' | 'clinic_information';
  specialty: Specialty | null;
  city: string;
  insurance: string;
  clinicIds?: string[];
  selectionIds?: string[];
  scope: 'all' | 'selection';
  nearest: boolean;
  clarification?: string;
  awaitingInsurance: boolean;
  detailsUnavailable: boolean;
  insuranceOverview: boolean;
  insuranceQuery: boolean;
}

export const catalogContext = (route: CatalogIntent, previous?: ChatContext): ChatContext => ({
  specialtyId: route.specialty?.id ?? null,
  clinicIds: previous?.clinicIds ?? [],
  city: route.city,
  insurance: route.awaitingInsurance ? '' : route.insurance,
  ...(previous?.care ? { care: previous.care } : {}),
  ...(previous?.symptomState ? { symptomState: previous.symptomState } : {}),
  catalog: {
    scope: route.scope,
    clinicIds: route.clinicIds ?? [],
    selectionIds: route.selectionIds ?? (route.scope === 'all' ? [] : (route.clinicIds ?? [])),
    resultIds: previous?.catalog?.resultIds ?? previous?.clinicIds ?? [],
    awaitingInsurance: route.awaitingInsurance,
  },
});

// Resolve entities using the visible database; coverage is never inferred by the model.
export async function routeCatalog(
  request: ChatRequest,
  catalog: CatalogRepository,
  resolver: SpecialtyResolver,
): Promise<CatalogIntent | null> {
  const text = normalize(request.message);
  // This must happen before matching clinic words or "qual especialidade".
  // "Qual especialidade devo procurar para essa dor?" is care navigation;
  // the catalog must never invent arbitrary clinic cards for it.
  if (requestsClinicalSpecialty(text)) return null;
  const meta = await catalog.metadata();
  const plans = resolveInsurances(text, meta.insurances);
  const insurances = plans.matches;
  const previous = request.context;
  // "próximo à virilha" is anatomical location, NOT a request for
  // geographically nearby clinics. With an active care interview, these
  // short answers must stay in the clinical conversation.
  const nearest = hasProximityRequest(text) && !(
    healthSignals.test(text) &&
    !hasCatalogNoun(text) &&
    !referencesPreviousClinics(text)
  );
  const entireCatalog = requestsEntireCatalog(text);
  const clearInsurance = clearsInsuranceFilter(text, plans.matches.length > 0);
  const compactPlan = plans.planOnly;
  const pendingPlan = Boolean(previous?.catalog?.awaitingInsurance && compactPlan);
  // Keep the original displayed group distinct from the most recent filtered
  // result, including when that result was empty. Do not let a second plan
  // comparison silently shrink the user's original three choices.
  const latestIds = previous?.catalog?.selectionIds ?? (
    previous?.catalog?.scope === 'selection' && previous.catalog.clinicIds.length
      ? previous.catalog.clinicIds
      : previous?.clinicIds.length
        ? previous.clinicIds
        : (previous?.catalog?.clinicIds ?? [])
  );
  const position = referencedClinicPosition(text, latestIds);
  const explicitReference = referencesPreviousClinics(text) || position !== null;
  const informationRequest = hasCatalogInformationRequest(text);
  const insuranceOverview =
    /\b(?:(?:qual|quais|que) (?:os |as )?(?:planos|convenios|operadoras)|lista (?:de )?(?:convenios|planos)|(?:planos|convenios) (?:que |sao )?(?:aceit\w*|atend\w*))\b/.test(
      text,
    ) &&
    !insurances.length &&
    !clearInsurance;
  const insuranceQuery =
    hasInsuranceRequest(text, insurances.length > 0) ||
    compactPlan ||
    clearInsurance ||
    ((hasCatalogNoun(text) || explicitReference) && /\baceit\w*\b/.test(text));
  const catalogAction =
    hasCatalogNoun(text) || informationRequest || nearest || explicitReference || entireCatalog;

  // "não quero clínica, quero uma especialidade" and similar corrections
  // are never permission to show the first three entries from an unfiltered catalog.
  if (/\b(?:nao quero|nao preciso|nenhuma|sem) clinicas?\b/.test(text) &&
      !insuranceQuery && !nearest && !entireCatalog && !explicitReference)
    return null;

  // A symptom plus a plan is still care navigation: resolve the specialty before filtering clinics.
  if (
    healthSignals.test(text) &&
    !hasCatalogNoun(text) &&
    !nearest &&
    !explicitReference &&
    !entireCatalog
  )
    return null;
  // An answer to an active clinical interview such as "na pelve, próximo à virilha"
  // is about ANATOMY, not the proximity of a clinic. A proximity term alone
  // must never interrupt an interview or trigger a catalog search.
  if (
    previous?.care &&
    !hasCatalogNoun(text) &&
    !informationRequest &&
    !insuranceQuery &&
    !entireCatalog
  ) return null;
  if (previous?.care && !catalogAction && !insuranceQuery) return null;
  if (previous?.care && !latestIds.length && compactPlan) return null;
  if (previous?.catalog?.resumeCare && !catalogAction) return null;

  const [specialties, inactive] = await Promise.all([
    resolver.mentions(text),
    resolver.mentions(text, false),
  ]);
  const cities = meta.cities.filter((name) => hasTerm(text, name));
  // Remove insurance entities before clinic matching. A shared brand is not a named clinic.
  // Explicit "Clínica X" remains available for matching the unit itself.
  let clinicText = text;
  for (const plan of insurances) {
    const short = normalize(plan)
      .split(/[^a-z0-9]+/)
      .filter((word) => !['saude', 'plano', 'de'].includes(word))
      .join(' ');
    for (const alias of [normalize(plan), short]) {
      if (!alias || new RegExp(`\\b(?:clinica|hospital|unidade)\\s+${alias}\\b`).test(text))
        continue;
      const expression = new RegExp(
        `\\b${[...alias.replace(/[^a-z0-9]/g, '')].join('[\\s.\\-]*')}\\b`,
        'g',
      );
      clinicText = clinicText.replace(expression, ' ');
    }
  }
  const named = await catalog.mentionedClinics(clinicText);
  const implicitReference = Boolean(
    previous &&
    insuranceQuery &&
    !hasCatalogNoun(text) &&
    /^(?:e\s+)?(?:qual|quais|alguma|algum|tem alguma|existe alguma)\b/.test(text),
  );
  const ellipticalPlan = Boolean(
    previous && insuranceQuery && !hasCatalogNoun(text) && !named.length,
  );
  const compactScope =
    compactPlan && previous?.catalog
      ? previous.catalog.scope === 'selection'
      : compactPlan && Boolean(previous?.clinicIds.length);
  // Clearing an insurance filter must NOT widen the set of clinics when the
  // user explicitly says "dessas clínicas". Reset the plan, not the scope.
  const referring =
    !entireCatalog &&
    (explicitReference ||
      (!clearInsurance && (
        implicitReference ||
        compactScope ||
        (ellipticalPlan && previous?.catalog?.scope !== 'all' && latestIds.length > 0) ||
        (pendingPlan && previous?.catalog?.scope === 'selection')
      )));
  const followup =
    referring ||
    pendingPlan ||
    ellipticalPlan ||
    (compactPlan && Boolean(previous)) ||
    (!entireCatalog && !hasCatalogNoun(text) && (nearest || /^e\b/.test(text)));

  if (!(catalogAction || insuranceQuery || named.length || specialties.length || inactive.length))
    return null;
  const information =
    informationRequest ||
    insuranceOverview ||
    (/\b(?:atende qual|quais delas|qual delas|qual era|quais eram)\b/.test(text) &&
      /\b(?:clinica medica|especialidade|clinica)\b/.test(text));
  const specialty =
    specialties[0] ??
    (followup && !entireCatalog && previous?.specialtyId
      ? await resolver.byId(previous.specialtyId)
      : null);
  const city = cities[0] ?? (request.city || (followup ? previous?.city : '') || '');
  const insurance =
    clearInsurance || insuranceOverview
      ? ''
      : (insurances[0] ?? (request.insurance || (followup ? previous?.insurance : '') || ''));

  let clinicIds: string[] | undefined;
  if (referring) {
    clinicIds = position ?? latestIds;
    if (named.length) clinicIds = clinicIds.filter((id) => named.includes(id));
  } else if (!entireCatalog && named.length) clinicIds = named;

  let clarification: string | undefined;
  let awaitingInsurance = false;
  if (clinicIds && clinicIds.length > 6) {
    clarification =
      'Encontrei várias unidades com esse nome. Qual é a unidade ou a cidade da clínica que você quer consultar?';
    clinicIds = undefined;
  }
  if (specialties.length > 1)
    clarification = 'Pesquiso uma especialidade por vez. Qual delas você quer consultar primeiro?';
  if (cities.length > 1)
    clarification = 'Informe uma cidade por consulta, ou ajuste o filtro de cidade.';
  if (plans.ambiguous || insurances.length > 1) {
    clarification = `Identifiquei mais de um convênio possível: ${insurances.join(', ')}. Qual deles você quer consultar primeiro?`;
    awaitingInsurance = true;
  }
  if (
    insuranceQuery &&
    !insuranceOverview &&
    !clearInsurance &&
    (hasUnrecognizedInsurance(text, meta.insurances) || !insurance)
  ) {
    clarification =
      'Qual é o nome do convênio? Não identifiquei um plano cadastrado nessa mensagem. Informe o nome ou selecione uma opção no filtro para consultar os dados publicados.';
    awaitingInsurance = true;
  }
  // A negative list cannot be derived from a missing registration of coverage.
  if (
    /\b(?:nao (?:aceit\w*|atend\w*|cobr\w*)|sem cobertura|nao (?:e|sao) credenciad\w*)\b/.test(text)
  ) {
    clarification =
      'A ausência de um convênio no cadastro não confirma que a clínica não o aceita. Posso consultar quais têm o plano registrado. Qual convênio você quer conferir?';
    awaitingInsurance = true;
  }
  if (referring && !clinicIds?.length)
    clarification =
      'Quais clínicas você quer comparar? Faça uma busca primeiro ou informe o nome de uma unidade.';
  if (information && !clinicIds?.length && !entireCatalog)
    clarification = 'Qual clínica você quer consultar? Informe o nome e, se possível, a unidade.';
  if (
    !named.length &&
    !referring &&
    /\b(?:a|o|na|no) (?:clinica|hospital|unidade)\s+(?!(?:de|que|mais|com|em|aceita|atende|tem|fica)\b)[a-z]/.test(
      text,
    )
  )
    clarification =
      'Não consegui identificar essa clínica no catálogo. Informe o nome e a unidade para consultar o cadastro correto.';
  if (inactive.length)
    clarification =
      'Essa especialidade não faz parte das opções ativas do MedFinder. Escolha uma das especialidades disponíveis no catálogo.';
  if (followup && previous?.specialtyId && !specialties.length && !specialty && !entireCatalog)
    clarification =
      'A especialidade da consulta anterior não está mais ativa. Escolha uma especialidade disponível.';

  return {
    intent: information ? 'clinic_information' : 'clinic_search',
    specialty: specialties.length > 1 ? null : specialty,
    city,
    insurance,
    clinicIds,
    // When the user asks about just the second clinic, the query is restricted
    // but the wider visible group remains available for later comparisons.
    selectionIds: referring ? latestIds : (clinicIds ?? undefined),
    scope: clinicIds !== undefined ? 'selection' : 'all',
    nearest,
    clarification,
    awaitingInsurance,
    detailsUnavailable: /horario|funciona|disponibilidade|vaga|preco|valor/.test(text),
    insuranceOverview,
    insuranceQuery: insuranceQuery && !insuranceOverview,
  };
}
