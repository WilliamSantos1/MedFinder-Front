import type { Source, Specialty } from '../../shared/contracts.js';
import { normalize } from './text.js';

const earSource: Source = {
  id: 'care-earache',
  title: 'Dor no ouvido: causas e quando procurar atendimento',
  url: 'https://www.nhs.uk/symptoms/earache/',
  publisher: 'NHS',
  excerpt:
    'Dor no ouvido pode ter diferentes causas. A persistência da dor e alterações de audição precisam de avaliação; objetos não devem ser introduzidos no ouvido.',
  isDemo: false,
};
const skinSource: Source = {
  id: 'care-itching',
  title: 'Coceira na pele: possíveis causas',
  url: 'https://www.nhs.uk/symptoms/itchy-skin/',
  publisher: 'NHS',
  excerpt:
    'Coceira pode acompanhar pele ressecada, irritada ou outras condições. A avaliação considera a pele e os demais sintomas.',
  isDemo: false,
};

/** Conservative injury signal; never converts an urgent complaint into an elective clinic search. */
export function earObjectConcern(messages: string[]) {
  return messages.some((message) => {
    const text = normalize(message);
    if (
      !/\bouvido\b/.test(text) ||
      !/\b(dor|doendo|doente|machuquei|feri|cocando|cocar|coceira)\b/.test(text)
    )
      return false;
    return [
      ...text.matchAll(
        /\b(usei|introduzi|coloquei|enfiei|meti)\b.{0,35}\b(lapis|caneta|grampo|palito|objeto)\b/g,
      ),
    ].some(
      (match) =>
        /\b(?:(?:para|pra) (?:cocar|limpar|cutucar)|(?:no|dentro do) (?:meu )?ouvido)\b/.test(
          text.slice(match.index!, match.index! + match[0].length + 65),
        ) && !/\b(?:nao|nunca)\s*$/.test(text.slice(Math.max(0, match.index! - 12), match.index)),
    );
  });
}

/** Reviewed descriptions, not raw model prose or diagnoses inferred from the clinic RAG. */
export function careExplanation(messages: string[], specialty?: Specialty | null) {
  const text = normalize(messages.join('\n'));
  if (earObjectConcern(messages))
    return {
      text: 'O desconforto no ouvido após o uso de um objeto pode estar relacionado a irritação ou lesão local. É necessário examinar o ouvido para esclarecer a causa.',
      sources: [earSource],
    };
  if (specialty?.id === 'otorrinolaringologia' && /\bouvido\b/.test(text))
    return {
      text: 'Dor ou coceira no ouvido pode ter diferentes causas, incluindo irritação e inflamação. O exame do ouvido ajuda a identificar o que está acontecendo.',
      sources: [earSource],
    };
  if (
    ['dermatologia', 'pediatria'].includes(specialty?.id ?? '') &&
    /\b(coceira|cocando|cocar|pele|manchas?)\b/.test(text)
  )
    return {
      text: 'A coceira e as alterações na pele podem estar relacionadas a irritação, ressecamento ou outras condições. A aparência da pele e os demais sintomas precisam ser avaliados para esclarecer a causa.',
      sources: [skinSource],
    };
  return {
    text: 'O desconforto relatado pode ter diferentes causas. A avaliação na especialidade indicada ajuda a investigar o problema; a orientação pelo chat não confirma um diagnóstico.',
    sources: [] as Source[],
  };
}
