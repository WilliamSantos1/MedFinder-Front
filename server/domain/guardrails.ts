import { normalize } from './text.js';

/**
 * Medication safety is intentionally detected with multiple signals instead of a finite drug list.
 * No list can contain every generic name, brand, compounded product or newly introduced medicine.
 * The lexicon below covers common examples/classes, while action/evaluation patterns catch requests
 * such as "posso tomar X?", "vou dar X", "isso resolve?", dose, interaction and combination questions.
 */
const medicationTerms =
  /\b(?:remedio|medicamento|medicacao|farmaco|comprimido|capsula|gotas?|xarope|pomada|creme medicinal|colirio|spray nasal|inalador|antibiotico|antimicrobiano|antiviral|antifungico|corticoide|anti-inflamatorio|analgesico|antitermico|antialergico|anti-histaminico|ansiolitico|antidepressivo|antipsicotico|anticonvulsivante|anticoagulante|antiagregante|antihipertensivo|diuretico|hipoglicemiante|insulina|broncodilatador|descongestionante|relaxante muscular|opioide|rivotril|clonazepam|diazepam|alprazolam|lorazepam|bromazepam|midazolam|zolpidem|dipirona|metamizol|novalgina|paracetamol|acetaminofeno|tylenol|ibuprofeno|advil|alivium|diclofenaco|voltaren|nimesulida|naproxeno|cetoprofeno|cetorolaco|meloxicam|celecoxibe|etoricoxibe|aas|aspirina|acido acetilsalicilico|amoxicilina|amoxicilina clavulanato|azitromicina|claritromicina|cefalexina|ceftriaxona|ciprofloxacino|levofloxacino|doxiciclina|metronidazol|sulfametoxazol trimetoprima|prednisona|prednisolona|dexametasona|betametasona|hidrocortisona|loratadina|desloratadina|cetirizina|fexofenadina|prometazina|omeprazol|pantoprazol|esomeprazol|famotidina|ondansetrona|dimenidrinato|dramin|metoclopramida|domperidona|simeticona|buscopan|escopolamina|salbutamol|aerolin|formoterol|budesonida|beclometasona|montelucaste|losartana|valsartana|enalapril|captopril|ramipril|amlodipino|atenolol|propranolol|metoprolol|carvedilol|hidroclorotiazida|furosemida|espironolactona|sinvastatina|atorvastatina|rosuvastatina|metformina|glibenclamida|gliclazida|dapagliflozina|empagliflozina|semaglutida|liraglutida|levotiroxina|puran t4|sertralina|fluoxetina|escitalopram|citalopram|paroxetina|venlafaxina|duloxetina|amitriptilina|nortriptilina|bupropiona|quetiapina|risperidona|olanzapina|haloperidol|lithium|litio|carbamazepina|oxcarbazepina|valproato|acido valproico|lamotrigina|gabapentina|pregabalina|fenitoina|topiramato|tramadol|codeina|morfina|oxicodona|dorflex|neosaldina|benegrip|coristina)\b/;

// Helps catch many generic drug names not explicitly listed above without depending only on brands.
const medicationLikeName =
  /\b[a-z][a-z0-9-]{3,}(?:pril|sartana|olol|statina|prazol|zepam|zolam|ciclina|micina|floxacino|vir|coxibe|gliptina|gliflozina|formina|gabalina|triptano)\b/;

const toxicSubstanceTerms =
  /\b(?:agua sanitaria|cloro|desinfetante|querosene|gasolina|veneno|inseticida|raticida|produto de limpeza|detergente|solvente)\b/;

const medicationAction =
  /\b(?:posso|devo|pode|poderia|vou|quero|preciso|pretendo|penso em|pensando em|acho que devo|acha que devo|acha que pode|seria melhor|e melhor)\s+(?:tomar|dar|oferecer|administrar|usar|aplicar|passar|ingerir|engolir|misturar|combinar|aumentar|diminuir|reduzir|parar|suspender|trocar)\b/;

const medicationUse =
  /\b(?:tomar|tomo|toma|tomei|tomou|tomando|tomava|dar|dou|dei|deu|dando|oferecer|ofereco|ofereci|administrar|administro|administrei|administrou|usar|uso|usa|usei|usou|usando|usava|aplicar|aplico|apliquei|aplicou|passar|passo|passei|passou|ingerir|ingiro|ingeri|ingeriu|engolir|engoli|engoliu|misturar|misturo|misturei|combinar|combino|combinei)\b/;

const medicationQuestion =
  /\b(?:qual|que|o que)\s+(?:remedio|medicamento|medicacao|comprimido|capsula|dose|dosagem)\b|\b(?:dose|dosagem|quantos?\s*(?:mg|mcg|g|ml|gotas?|comprimidos?|capsulas?))\b|\b(?:me receita|receita|receitar|prescrev|prescricao)\w*\b|\b(?:contraindicacao|interacao|efeitos? colaterais?|efeitos? adversos?)\b/;

const medicationEvaluation =
  /\b(?:pode ser|serve|serviria|ajuda|ajudaria|funciona|funcionaria|resolve|resolveria|melhora|melhoraria|e bom|seria bom|indicado|indicada|recomenda|recomendaria|vale a pena|faz efeito|vai fazer efeito|pode ajudar|pode resolver|e seguro|e segura|seria seguro|seria segura|faz mal|tem problema|contraindicado|contraindicada)\b/;

const professionalPrescription =
  /\b(?:medic[oa]|profissional|farmaceutic[oa])\s+(?:passou|receitou|prescreveu|indicou|orientou|mandou)|\b(?:foi|esta)\s+prescrit[oa]|\btenho\s+receita\b|\borientacao medica\b/;

const treatmentPurpose =
  /\b(?:para|pra)\s+(?:dor|febre|tontura|vertigem|coceira|tosse|gripe|resfriado|alergia|ansiedade|insonia|nausea|enjoo|vomito|diarreia|inflamacao|infeccao|pressao|sintoma|melhorar|resolver|tratar)\b/;

const toxicAction =
  /\b(?:posso|devo|pode|poderia|vou|quero)\s+(?:tomar|beber|ingerir|engolir|usar|misturar)\b/;

const ingestion =
  /\b(?:tomei|tomou|ingeri|ingeriu|engoli|engoliu|bebi|bebeu|dei|deu|administrei|administrou|usei|usou)\b/;

const overdoseSignal =
  /\b(?:muitos?|varios?|demais|dose dupla|dose maior|mais do que|acima do|sem querer|por engano|acidentalmente|\d{2,}\s*(?:comprimidos?|capsulas?))\b/;

function hasMedicationSignal(text: string) {
  return medicationTerms.test(text) || medicationLikeName.test(text);
}

/**
 * Returns true whenever the user is asking the app to recommend, validate, compare, dose,
 * combine or otherwise guide medication use. It also intercepts a medication-use statement
 * when a medicine is named, so the app can show the same boundary and continue focusing on symptoms.
 */
export function medicationAdviceRequest(message: string) {
  const text = normalize(message);
  const medication = hasMedicationSignal(text);

  if (medicationQuestion.test(text)) return true;

  if (
    medication &&
    (medicationAction.test(text) ||
      medicationUse.test(text) ||
      medicationEvaluation.test(text) ||
      professionalPrescription.test(text))
  )
    return true;

  // Unknown/new product names can still be intercepted when the sentence clearly asks for
  // treatment guidance. This avoids depending on an impossible "all medicines" list.
  if (
    medicationUse.test(text) &&
    (medicationEvaluation.test(text) || treatmentPurpose.test(text))
  )
    return true;

  return false;
}

export function toxicSubstanceAdviceRequest(message: string) {
  const text = normalize(message);
  return toxicSubstanceTerms.test(text) && toxicAction.test(text);
}

export function possibleMedicationPoisoning(message: string) {
  const text = normalize(message);

  return (
    (hasMedicationSignal(text) &&
      ingestion.test(text) &&
      overdoseSignal.test(text)) ||
    (toxicSubstanceTerms.test(text) &&
      ingestion.test(text))
  );
}

export function specialtyConfirmationRequest(message: string) {
  const text = normalize(message).trim();

  return (
    /^(?:tem|voce tem|voces tem) certeza\??$/.test(text) ||
    /^(?:confirma|pode confirmar|essa especialidade mesmo|e essa especialidade mesmo)\??$/.test(
      text,
    ) ||
    /\btem certeza (?:disso|dessa especialidade)?\b/.test(text)
  );
}