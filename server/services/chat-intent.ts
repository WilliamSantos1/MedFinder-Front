import type { ChatRequest, Specialty } from '../../shared/contracts.js';
import { normalize } from '../domain/text.js';
import type { CatalogRepository } from '../db/catalog.js';
import type { SpecialtyResolver } from './specialty-resolver.js';

const hasTerm = (text: string, term: string) =>
  ` ${text.replace(/[^a-z0-9]+/g, ' ')} `.includes(
    ` ${normalize(term).replace(/[^a-z0-9]+/g, ' ')} `,
  );

const healthSignals =
  /\b(dor|dores|doi|doendo|febre|sangramento|vomit\w*|enjoo|coceira|cocando|desconforto|falta de ar|tontura|vertigem|sintomas?|ansiedade|depressao|insonia|ardencia|irritacao|vermelh\w*|coriza|rinite|congestao|espirros?|tosse|secrecao|nausea|diarreia|inchaco|refluxo|azia|gastrite|enxaqueca|cefaleia|palpitacao|palpitacoes|urinar|urina|bexiga|pele|olho|olhos|ouvido|ouvidos|joelho|ombro|pescoco|coluna|estomago|abdomen|barriga)\b/;

const strongCatalogRequest = (text: string) =>
  /\b(?:clinica|clinicas|hospital|unidade|unidades|convenio|convenios|plano|planos|unimed|aceita|aceitam|opcoes|listar|mostre|mostrar)\b/.test(text) ||
  /\b(?:onde fica|endereco|telefone|contato|horario|atende qual|quais especialidades|disponibilidade)\b/.test(text) ||
  /proxim|perto|distancia/.test(text);

const explicitCatalogRequest = (text: string) =>
  /\b(?:clinica|clinicas|hospital|unidade|convenio|convenios|plano|planos|unimed|opcoes)\b/.test(text) ||
  /\b(?:onde fica|endereco|telefone|contato|horario|atende qual|quais especialidades|qual especialidade|disponibilidade)\b/.test(
    text,
  ) ||
  /proxim|perto|distancia/.test(text);

const insuranceNoise = new Set(['saude', 'plano', 'assistencia', 'medica', 'beneficio']);

function insuranceMentions(text: string, options: string[]) {
  const exact = options.filter((name) => hasTerm(text, name));
  if (exact.length) return exact;

  const words = new Set(text.replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean));
  const matches = options.filter((name) => {
    const tokens = normalize(name)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !insuranceNoise.has(token));
    return tokens.some((token) => words.has(token));
  });
  // Never guess when a short brand token maps to more than one configured plan.
  return matches.length === 1 ? matches : [];
}

export interface CatalogIntent {
  intent: 'clinic_search' | 'clinic_information';
  specialty: Specialty | null;
  city: string;
  insurance: string;
  clinicIds?: string[];
  nearest: boolean;
  clarification?: string;
  detailsUnavailable: boolean;
}

// Resolve entities using the current database, never a fixed specialty enum or LLM memory.
export async function routeCatalog(
  request: ChatRequest,
  catalog: CatalogRepository,
  resolver: SpecialtyResolver,
): Promise<CatalogIntent | null> {
  const text = normalize(request.message);

  // Answers to an ongoing care interview stay in care navigation unless the user explicitly
  // asks for the catalog. This prevents phrases such as "os sintomas são esses" from matching
  // a clinic name (e.g. "São Carlos") and skipping specialty resolution.
  if (request.context?.care && !explicitCatalogRequest(text)) return null;

  // Questions about whether a symptom/condition belongs to a specialty are care-navigation,
  // not catalog searches. Example: "refluxo seria ortopedia?". A strong catalog action such as
  // "quais clínicas de ortopedia..." still wins even when the user mentions a symptom.
  if (healthSignals.test(text) && !strongCatalogRequest(text)) return null;

  const [specialties, meta, named, inactive] = await Promise.all([
    resolver.mentions(text),
    catalog.metadata(),
    catalog.mentionedClinics(text),
    resolver.mentions(text, false),
  ]);
  const nearest = /proxim|perto|distancia/.test(text);
  const followup =
    /^(e\b|qual dessas|quais dessas|dessas\b)|\b(dessas|desses|delas|deles)\b/.test(text) ||
    nearest;
  const information =
    /onde fica|endereco|telefone|contato|horario|atende qual|quais especialidades|qual especialidade|funciona|disponibilidade/.test(
      text,
    );
  const catalogQuery =
    nearest ||
    information ||
    named.length > 0 ||
    specialties.length > 0 ||
    inactive.length > 0 ||
    /\b(?:clinica|clinicas|hospital|unidade|convenio|convenios|plano|planos|aceit|atendimento|opcoes|unimed)\b/.test(
      text,
    );
  if (!catalogQuery) return null;

  const cities = meta.cities.filter((name) => hasTerm(text, name));
  const insurances = insuranceMentions(text, meta.insurances);
  const insuranceQuery =
    insurances.length > 0 && /\b(aceit|aceita|aceitam|convenio|convenios|plano|planos)\b/.test(text);
  const previous = followup ? request.context : undefined;
  const specialty =
    specialties[0] ?? (previous?.specialtyId ? await resolver.byId(previous.specialtyId) : null);
  const city = request.city || cities[0] || previous?.city || '';
  const insurance = request.insurance || insurances[0] || previous?.insurance || '';
  let clarification: string | undefined;

  if (specialties.length > 1)
    clarification = 'Pesquiso uma especialidade por vez. Qual delas você quer consultar primeiro?';
  if (cities.length > 1 || insurances.length > 1)
    clarification = 'Informe uma cidade e um convênio por consulta, ou ajuste os filtros.';
  if (/meu convenio|meu plano/.test(text) && !insurance)
    clarification = 'Qual é o seu convênio? Selecione no filtro ou informe o nome.';
  if (
    /aceit|convenio|plano/.test(text) &&
    !insurance &&
    !/quais convenios|qual convenio/.test(text)
  )
    clarification =
      'Não identifiquei um convênio cadastrado. Selecione o nome no filtro de convênio para conferir a cobertura publicada.';

  // A clinic name can contain the same word as an insurance brand.
  // Example: "Clínica Unimed" must not turn "quais clínicas aceitam Unimed?"
  // into a lookup for that single clinic. In an explicit insurance query, the
  // insurance entity wins; named-clinic routing is kept for questions such as
  // "onde fica a Clínica Unimed?".
  const clinicIds = !insuranceQuery && named.length
    ? named
    : /\b(dessas|desses|delas|deles)\b/.test(text)
      ? previous?.clinicIds
      : undefined;
  if (information && !clinicIds?.length)
    clarification = 'Qual clínica você quer consultar? Informe o nome e, se possível, a unidade.';
  if (
    followup &&
    !specialty &&
    !insurance &&
    !clinicIds?.length &&
    !named.length &&
    !request.context
  )
    clarification ??= 'Qual especialidade ou clínica você procura?';
  if (!specialties.length && previous?.specialtyId && !specialty)
    clarification =
      'A especialidade da consulta anterior não está mais ativa. Escolha uma especialidade disponível.';
  if (inactive.length)
    clarification =
      'Essa especialidade não faz parte das opções ativas do MedFinder. Escolha uma das especialidades disponíveis no catálogo.';

  return {
    intent: information ? 'clinic_information' : 'clinic_search',
    specialty: specialties.length > 1 ? null : specialty,
    city,
    insurance,
    clinicIds,
    nearest,
    clarification,
    detailsUnavailable: /horario|funciona|disponibilidade|vaga|preco|valor/.test(text),
  };
}
