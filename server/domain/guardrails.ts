import { normalize } from './text.js';

/**
 * Medication safety is intentionally detected with multiple signals instead of a finite drug list.
 * No list can contain every generic name, brand, compounded product or newly introduced medicine.
 * The lexicon below covers common examples/classes, while action/evaluation patterns catch requests
 * such as "posso tomar X?", "vou dar X", "isso resolve?", dose, interaction and combination questions.
 */
const medicationTerms =
  /\b(?:remedios?|medicamentos?|medicac(?:ao|oes)|farmacos?|comprimidos?|capsulas?|gotas?|xarope|pomada|creme medicinal|colirio|spray nasal|inalador|antibiotico|antimicrobiano|antiviral|antifungico|corticoide|anti-inflamatorio|analgesico|antitermico|antialergico|anti-histaminico|ansiolitico|antidepressivo|antipsicotico|anticonvulsivante|anticoagulante|antiagregante|antihipertensivo|diuretico|hipoglicemiante|insulina|broncodilatador|descongestionante|relaxante muscular|opioide|rivotril|clonazepam|diazepam|alprazolam|lorazepam|bromazepam|midazolam|zolpidem|dipirona|metamizol|novalgina|paracetamol|acetaminofeno|tylenol|ibuprofeno|advil|alivium|diclofenaco|voltaren|nimesulida|naproxeno|cetoprofeno|cetorolaco|meloxicam|celecoxibe|etoricoxibe|aas|aspirina|acido acetilsalicilico|amoxicilina|amoxicilina clavulanato|azitromicina|claritromicina|cefalexina|ceftriaxona|ciprofloxacino|levofloxacino|doxiciclina|metronidazol|sulfametoxazol trimetoprima|prednisona|prednisolona|dexametasona|betametasona|hidrocortisona|loratadina|desloratadina|cetirizina|fexofenadina|prometazina|omeprazol|pantoprazol|esomeprazol|famotidina|ondansetrona|dimenidrinato|dramin|metoclopramida|domperidona|simeticona|buscopan|escopolamina|salbutamol|aerolin|formoterol|budesonida|beclometasona|montelucaste|losartana|valsartana|enalapril|captopril|ramipril|amlodipino|atenolol|propranolol|metoprolol|carvedilol|hidroclorotiazida|furosemida|espironolactona|sinvastatina|atorvastatina|rosuvastatina|metformina|glibenclamida|gliclazida|dapagliflozina|empagliflozina|semaglutida|liraglutida|levotiroxina|puran t4|sertralina|fluoxetina|escitalopram|citalopram|paroxetina|venlafaxina|duloxetina|amitriptilina|nortriptilina|bupropiona|quetiapina|risperidona|olanzapina|haloperidol|lithium|litio|carbamazepina|oxcarbazepina|valproato|acido valproico|lamotrigina|gabapentina|pregabalina|fenitoina|topiramato|tramadol|codeina|morfina|oxicodona|dorflex|neosaldina|benegrip|coristina)\b/;

// Helps catch many generic drug names not explicitly listed above without depending only on brands.
const medicationLikeName =
  /\b[a-z][a-z0-9-]{3,}(?:pril|sartana|olol|statina|prazol|zepam|zolam|ciclina|micina|floxacino|vir|coxibe|gliptina|gliflozina|formina|gabalina|triptano)\b/;

const toxicSubstanceTerms =
  /\b(?:agua sanitaria|cloro|desinfetante|querosene|gasolina|veneno|inseticida|raticida|produto de limpeza|detergente|solvente)\b/;

// Forms are deliberately grouped by intent, not by an exhaustive list of drugs.
// "ministrar" (and derived forms) must be handled like "administrar" or "dar".
const medicationVerbs =
  /\b(?:tom(?:ar|o|a|ou|ei|ando|ava|avam|ara|aria|e)|dar|dou|dei|deu|dando|der|daria|oferec\w*|ministr\w*|administr\w*|medic(?:ar|o|ei|ou|ando|ando-a|ada|ado)|inger\w*|ingir\w*|engol\w*|us(?:ar|o|a|ei|ou|ando|ava)|aplic\w*|pass(?:ar|o|ei|ou|ando)|receit\w*|prescrev\w*|prescri\w*|indic\w*|recomend\w*|mistur\w*|combin\w*|associ\w*|dilui\w*|injet\w*|pulveriz\w*|ping\w*|aument\w*|reduz\w*|diminu\w*|cort\w*|suspend\w*|interromp\w*|parar|trocar|substitu\w*|dobr\w*|repet\w*)\b/;

const medicationAction =
  /\b(?:posso|pode|poderia|podemos|devo|deveria|deve|seria seguro|e seguro|sera que|vou|quero|preciso|pretendo|penso em|pensando em|estou pensando em|acho que devo|acha que devo|acha que pode|seria melhor|e melhor|me recomenda|qual a melhor forma de|tem problema em|faz mal|e permitido|estaria certo|ta certo|esta certo|correto)\b.{0,80}\b(?:tomar|dar|oferecer|ministrar|administrar|medicar|usar|aplicar|passar|ingerir|engolir|misturar|combinar|associar|injetar|pingar|aumentar|diminuir|reduzir|parar|suspender|trocar|substituir|dobrar|repetir)\b/;

const medicationUse = medicationVerbs;

// A long-term treatment mentioned in the medical history is not a request to
// recommend a medicine. Preserve symptom navigation in that case.
const backgroundMedicationUse =
  /\b(?:costum\w*|geralmente|habitualmente|normalmente|regularmente|todos os dias|todo dia|diariamente|uso continuo|faz uso de|toma sempre|toma diariamente|usa sempre|usa diariamente|toma remedios? (?:para|pro|pra|de)|toma medicamentos? (?:para|pro|pra|de)|usa remedios? (?:para|pro|pra|de)|usa medicamentos? (?:para|pro|pra|de))\b/;

const medicationRiskQuestion =
  /\b(?:pode causar|tem risco|da sono|vicia|dependencia|interage com|pode misturar|pode combinar|tem alguma interacao|faz mal tomar)\b/;

const medicationQuestion =
  /\b(?:qual|quais|que|o que|quanto|quantos?|quantas?)\s+(?:remedios?|medicamentos?|medicac(?:ao|oes)|comprimidos?|capsulas?|doses?|dosagem|posologia)\b|\b(?:dose|dosagem|posologia|intervalo entre doses|quantos?\s*(?:mg|mcg|g|ml|gotas?|comprimidos?|capsulas?))\b|\b(?:me receita|receita|receitar|prescrev|prescricao)\w*\b|\b(?:contraindicacao|contraindicacoes|interacao|interacoes|efeitos? colaterais?|efeitos? adversos?)\b/;

const medicationEvaluation =
  /\b(?:pode ser|serve|serviria|ajuda|ajudaria|funciona|funcionaria|resolve|resolveria|melhora|melhoraria|e bom|seria bom|indicado|indicada|recomenda|recomendaria|vale a pena|faz efeito|vai fazer efeito|pode ajudar|pode resolver|e seguro|e segura|seria seguro|seria segura|faz mal|tem problema|contraindicado|contraindicada|pode tomar|pode dar|e permitido|faz sentido|e apropriado|e adequado|e eficaz|da certo|daria certo|posso continuar|devo continuar)\b/;

const professionalPrescription =
  /\b(?:medic[oa]|profissional|farmaceutic[oa])\s+(?:passou|receitou|prescreveu|indicou|orientou|mandou)|\b(?:foi|esta)\s+prescrit[oa]|\btenho\s+receita\b|\borientacao medica\b/;

// When an unfamiliar product is mentioned with an explicit treatment purpose,
// intercept ONLY an actual administration question, not words like "indicado".
const unfamiliarAdministrationIntent =
  /\b(?:posso|pode|devo|deveria|vou|quero|pretendo|estou pensando em|seria seguro)\b.{0,80}\b(?:tomar|dar|ministrar|administrar|medicar|ingerir|engolir|aplicar|usar)\b/;
const treatmentPurpose =
  /\b(?:para|pra)\s+(?:dor|febre|tontura|vertigem|coceira|tosse|gripe|resfriado|alergia|ansiedade|insonia|nausea|enjoo|vomito|diarreia|inflamacao|infeccao|pressao|sintoma|melhorar|resolver|tratar)\b/;

const toxicAction =
  /\b(?:posso|devo|pode|poderia|vou|quero|pretendo)\s+(?:tomar|beber|ingerir|engolir|usar|misturar|administrar|ministrar|dar|aplicar|inalar|injetar)\b/;

const ingestion =
  /\b(?:tomei|tomou|tomaram|ingeri|ingeriu|ingeriram|engoli|engoliu|engoliram|bebi|bebeu|beberam|dei|deu|deram|ministrei|ministrou|ministraram|administrei|administrou|administraram|mediquei|medicou|usou|usei|usaram|aplicou|apliquei|aplicaram)\b/;

const overdoseSignal =
  /\b(?:muit[oa]s?|vari[oa]s?|demais|dose dupla|dose tripla|dose maior|superdose|quantidade excessiva|em excesso|mais do que|acima do|sem querer|por engano|acidentalmente|dose errada|frasco inteiro|caixa inteira|\d{2,}\s*(?:comprimidos?|capsulas?|gotas?))\b/;

function hasMedicationSignal(text: string) {
  return medicationTerms.test(text) || medicationLikeName.test(text);
}

/**
 * Returns true whenever the user is asking the app to recommend, validate, compare, dose,
 * combine or otherwise guide medication use. It also intercepts a medication-use statement
 * when a medicine is named, so the app can show the same boundary and continue focusing on symptoms.
 */
export function medicationAdviceRequest(message: string, history: string[] = []) {
  const text = normalize(message);
  const medication = hasMedicationSignal(text);

  // Short follow-ups can omit the drug name. Only the latest turn in this clinical episode
  // supplies that referent; catalog questions and new complaints must not inherit this boundary.
  const last = normalize(history.at(-1) ?? '');
  if (
    hasMedicationSignal(last) &&
    !/\b(?:clinicas?|convenios?|planos?|enderecos?|telefone|especialidade)\b/.test(text) &&
    (medicationAction.test(text) ||
      (/\b(?:e se|se eu|se ele|se ela|metade|dobro)\b/.test(text) && medicationUse.test(text)) ||
      (/\b(?:isso|esse|essa|ele|ela|metade|dobro|junto|continuar)\b/.test(text) &&
        medicationEvaluation.test(text)))
  )
    return true;

  if (medicationQuestion.test(text)) return true;

  if (medication) {
    // Asking for validation, administration, dose, benefit, safety or a change
    // to a prescription is always blocked. Mentioning regular use alone is not.
    if (
      medicationAction.test(text) ||
      medicationEvaluation.test(text) ||
      medicationRiskQuestion.test(text)
    )
      return true;
    if (
      professionalPrescription.test(text) &&
      /\b(?:posso|pode|devo|deveria|aumentar|reduzir|trocar|continuar|parar)\b/.test(text)
    )
      return true;
    if (medicationUse.test(text) && !backgroundMedicationUse.test(text)) return true;
  }

  // Do not interpret general referral words such as "indicado", "recomendado"
  // or "adequado" as medication advice when NO medicine was mentioned.
  // An unfamiliar product cannot safely be inferred to be a drug from these
  // generic verbs alone; the medical model independently avoids prescriptions.
  if (
    !backgroundMedicationUse.test(text) &&
    unfamiliarAdministrationIntent.test(text) &&
    treatmentPurpose.test(text)
  ) return true;


  // A clearly pharmaceutical action can be intercepted even with an unknown product name.
  if (
    /\b(?:posso|pode|devo|deveria|preciso|seria seguro)\b.{0,65}\b(?:ministrar|administrar|medicar|prescrever)\b/.test(
      text,
    )
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
    (hasMedicationSignal(text) && ingestion.test(text) && overdoseSignal.test(text)) ||
    (toxicSubstanceTerms.test(text) && ingestion.test(text))
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
