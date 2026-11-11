
import { normalize } from './text.js';

/**
 * Portuguese variants for catalog requests.
 * A verb alone is not proof of an insurance request.
 */
const insuranceNoun =
  /\b(?:convenios?|planos?(?: de saude)?|operadora(?:s)?|carteirinha|cobertura|rede credenciada|rede referenciada|plano particular|seguro saude|seguradora de saude)\b/;

const coverageVerb =
  /\b(?:aceit\w*|atend\w*|cobr\w*|contempl\w*|credenci\w*|conveni\w*|trabalh\w*\s+(?:com|pelo|pela)|tem\s+(?:contrato|parceria|convenio|cobertura)|(?:faz|fazem|fazia|faziam|fazendo)\s+(?:parte\s+d[ao]\s+(?:rede|convenio)|atendimento\s+(?:por|pelo|pela))|pertenc\w*\s+a\s+rede|e\s+(?:da\s+rede|conveniad\w*|credenciad\w*)|esta\s+(?:na\s+rede|credenciad\w*|conveniad\w*)|realiz\w*\s+atendimento\s+(?:por|pelo|pela)|pass\w*\s+(?:o|pelo|pela)\s+plano|possui\s+(?:convenio|cobertura|credenciamento)|tem\s+atendimento\s+(?:por|pelo|pela))\b/;

const coverageQuestion =
  /\b(?:quais?\s+(?:planos?|convenios?|operadoras?)|qual\s+(?:plano|convenio|operadora)|pelo\s+(?:plano|convenio)|pela\s+(?:operadora|carteirinha)|no\s+(?:plano|convenio)|com\s+(?:o\s+)?(?:plano|convenio)|atendimento\s+(?:pelo|pela)\s+plano)\b/;

/**
 * References to clinics already displayed.
 * "Dessas", "destas", "nessas", etc. must preserve
 * the previous clinic IDs instead of searching
 * the entire catalog again.
 */
const clinicReference =
  /\b(?:dessas?|desses?|destas?|destes?|nessas?|nesses?|nestas?|nestes?|delas?|deles|daquelas?|daqueles?|as\s+(?:tres|3)\s+(?:clinicas|opcoes)|(?:qual|quais)\s+das\s+clinicas|entre\s+as\s+clinicas|dentre\s+as\s+clinicas|essas?\s+(?:clinicas|opcoes|unidades)|as\s+(?:clinicas|opcoes)\s+que\s+(?:voce\s+)?(?:indicou|mostrou)|qual\s+era\s+a\s+clinica|entre\s+(?:essas?|aquelas?|as\s+(?:tres|3))|dentre\s+(?:essas?|aquelas?)|(?:entre|dentre)\s+(?:as\s+)?(?:opcoes|alternativas|clinicas|unidades)(?:\s+(?:anteriores|indicadas|mostradas))?|da\s+lista|dessa\s+lista|que\s+(?:voce\s+)?(?:indicou|mostrou|listou|sugeriu|apresentou)|mencionad[ao]s?\s+antes|citad[ao]s?\s+antes|opcoes\s+anteriores|clinicas\s+anteriores|das\s+opcoes\s+anteriores|mesmas\s+clinicas)\b/;

const shownClinicReference =
  /\b(?:estas?|estes?|essas?|esses?|aquelas?|aqueles?)\s+(?:(?:tres|3)\s+)?(?:clinicas?|opcoes|alternativas|unidades|estabelecimentos?)\b/;

const catalogNoun =
  /\b(?:clinicas?|hospitais?|unidades?|consultorios?|laboratorios?|centros? medicos?|estabelecimentos?|profissionais?)\b/;

const catalogInformation =
  /\b(?:onde fica|onde est[ao]|enderecos?|localizad[ao]s?|telefone|contatos?|whatsapp|como chegar|como faco (?:para|pra) chegar|qual e o caminho|horarios?|quando abre|quando fecha|funciona|disponibilidade|agendamento|agendar|marcar consulta|precos?|valores?|custo|quanto custa|quais? especialidades|que especialidades|qual especialidade|especialidades que (?:atende|tem)|quais? servicos|que servicos)\b/;

const proximity =
  /\b(?:proxim\w*|perto|distanci\w*|mais perto|mais proxima|mais proximo|pertinho|redondezas|nos arredores|perto daqui|aqui perto|mais proximo de mim|perto de onde estou)\b/;

/**
 * A patient can ask for the specialty without
 * asking for a clinic list.
 */
export const requestsSpecialtyWithoutClinics = (message: string) => {
  const text = normalize(message);

  return (
    /\b(?:nao (?:quero|preciso|procuro)|nenhuma|sem) clinicas?\b/.test(text) &&
    /\b(?:especialidade|especialista|medico|profissional)\b/.test(text)
  );
};

/**
 * Questions about WHICH specialty a patient's symptoms
 * warrant are care navigation, not requests for the
 * name/address/specialties of an establishment.
 *
 * These are intentionally independent of the finite
 * body-part symptom vocabulary.
 */
export const requestsClinicalSpecialty = (message: string) => {
  const text = normalize(message);

  // Explicit correction:
  // "não quero clínicas, só quero saber a especialidade".
  if (
    /\b(?:nao (?:quero|preciso|procuro)|nenhuma|sem) clinicas?\b/.test(text) &&
    /\b(?:especialidade|especialista|medico|profissional|sintoma|dor|atendimento)\b/.test(text)
  ) {
    return true;
  }

  // When a named establishment is the subject,
  // "qual especialidade ela atende?" is a factual
  // catalog question, not clinical navigation.
  if (
    !/\b(?:nao (?:quero|preciso|procuro)|nenhuma|sem) clinicas?\b/.test(text) &&
    /\b(?:clinica|hospital|unidade)\s+[a-z0-9][a-z0-9-]*/.test(text) &&
    /\b(?:qual|quais|que)\s+(?:a |as |o |os )?especialidades?\b/.test(text)
  ) {
    return false;
  }

  // An explicit clinic-information request
  // still belongs to the catalog.
  if (
    /\b(?:dessas?|destas?|nessas?|nestas?) clinicas?\b/.test(text) ||
    /\b(?:qual|quais|que) (?:a |as |os )?especialidades? (?:a |as |estas |essas |dessa |desta )?clinicas?\b/.test(text)
  ) {
    return false;
  }

  if (
    /\b(?:qual|quais|que)\s+(?:seria\s+)?(?:a |o |as |os )?(?:melhor |mais adequada? |mais indicado? )?(?:especialidade|especialista|medico|profissional)(?:\s+(?:seria|e|seriam|sao|procurar|devo|indicado|adequad[ao]))?\b/.test(text)
  ) {
    return true;
  }

  if (
    /\b(?:saber|indicar|identificar|descobrir|orientar|recomendar)\b.{0,65}\b(?:especialidade|especialista|medico|profissional)\b/.test(text)
  ) {
    return true;
  }

  if (
    /\b(?:para|pra) qual (?:especialidade|especialista|medico)\b/.test(text)
  ) {
    return true;
  }

  return false;
};

export const hasInsuranceRequest = (
  message: string,
  knownPlan: boolean,
) => {
  const text = normalize(message);

  return (
    insuranceNoun.test(text) ||
    coverageQuestion.test(text) ||
    (knownPlan && coverageVerb.test(text))
  );
};

export const hasInsuranceNoun = (message: string) =>
  insuranceNoun.test(normalize(message));

export const referencesPreviousClinics = (message: string) => {
  const text = normalize(message);

  return clinicReference.test(text) || shownClinicReference.test(text);
};

export const hasCatalogNoun = (message: string) => {
  const text = normalize(message);

  return (
    catalogNoun.test(text) ||
    (/\b(?:opcoes|alternativas)\b/.test(text) &&
      /\b(?:clinicas?|hospitais?|unidades?|consultorios?|atendimento|proxim\w*|perto)\b/.test(text))
  );
};

export const hasCatalogInformationRequest = (message: string) =>
  catalogInformation.test(normalize(message));

export const hasProximityRequest = (message: string) =>
  proximity.test(normalize(message));

export const requestsEntireCatalog = (message: string) =>
  /\b(?:todas? as clinicas|todas? as unidades|todas? as opcoes|toda (?:a )?(?:base|rede)|todo (?:o )?catalogo|(?:em|no) (?:todo o )?catalogo|em geral|qualquer especialidade|outras clinicas|fora (?:dessas|destas|da lista)|amplia\w* (?:a )?busca|busq\w* (?:em )?tudo)\b/.test(
    normalize(message),
  );

/**
 * Explicitly clearing a previous insurance is
 * a filter operation, not a question about whether
 * the named clinic accepts that insurer.
 *
 * Works with any known plan.
 */
export const clearsInsuranceFilter = (
  message: string,
  mentionsKnownPlan = false,
) => {
  const text = normalize(message);

  if (
    /\b(?:(?:sem|remov\w*|tir\w*) (?:o )?filtro (?:de )?(?:convenio|plano)|qualquer (?:convenio|plano)|independente (?:do|de) (?:convenio|plano)|todos os convenios|(?:esquec\w*|desconsider\w*) (?:o )?(?:plano|convenio))\b/.test(text)
  ) {
    return true;
  }

  const noRequirement =
    /\b(?:nao (?:precis\w*|quer\w*|necessit\w*|tem que|faz questao)|sem necessidade)(?:\s+[a-z]+){0,8}\s+(?:pelo|pela|do|da|por|com|de)\s+[a-z]/.test(text);

  return (
    noRequirement &&
    (mentionsKnownPlan ||
      /\b(?:plano|convenio|operadora|cobertura|carteirinha)\b/.test(text))
  );
};

export function referencedClinicPosition(
  message: string,
  ids: string[],
) {
  const text = normalize(message);

  if (/\b(?:a|da|na) primeira\b/.test(text))
    return ids.slice(0, 1);

  if (/\b(?:a|da|na) segunda\b/.test(text))
    return ids.slice(1, 2);

  if (/\b(?:a|da|na) terceira\b/.test(text))
    return ids.slice(2, 3);

  if (/\b(?:a|da|na) ultima\b/.test(text))
    return ids.slice(-1);

  return null;
}

/**
 * Distinguish a clinic brand from an insurance name.
 */
export const explicitlyNamesClinicBrand = (
  message: string,
  plan: string,
) => {
  const text = normalize(message);

  const escaped = normalize(plan).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );

  return new RegExp(
    `\\b(?:clinica|hospital|unidade)\\s+${escaped}\\b`,
  ).test(text);
};
