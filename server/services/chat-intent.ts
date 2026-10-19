import type { ChatRequest, Specialty } from '../../shared/contracts.js';
import { normalize } from '../domain/text.js';
import type { CatalogRepository } from '../db/catalog.js';
import type { SpecialtyResolver } from './specialty-resolver.js';

const hasTerm = (text: string, term: string) =>
  ` ${text.replace(/[^a-z0-9]+/g, ' ')} `.includes(
    ` ${normalize(term).replace(/[^a-z0-9]+/g, ' ')} `,
  );
const symptoms =
  /\b(dor|dores|doi|doendo|febre|sangramento|vomit|enjoo|coceira|cocando|desconforto|falta de ar|tontura|sintoma|ansiedade)\b/;
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
  if (symptoms.test(text)) return null;
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
    /clinic|convenio|aceit|atendimento|opcoes|unimed/.test(text);
  if (!catalogQuery) return null;
  const cities = meta.cities.filter((name) => hasTerm(text, name));
  const insurances = meta.insurances.filter((name) => hasTerm(text, name));
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
  // An unknown insurance must never turn into an unfiltered list of clinics.
  if (
    /aceit|convenio|plano/.test(text) &&
    !insurance &&
    !/quais convenios|qual convenio/.test(text)
  )
    clarification =
      'Não identifiquei um convênio cadastrado. Selecione o nome no filtro de convênio para conferir a cobertura publicada.';
  const clinicIds = named.length
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
