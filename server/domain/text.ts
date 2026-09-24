export const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const stopwords = new Set(
  'a o e de da do das dos em no na nos nas um uma uns umas eu me meu minha esta estou com para por que qual quais como isso tenho tem sinto muito mais nao sim desde ontem hoje quero sobre pode favor voce seria ha faz dias dor dores sintomas sintoma problema saude ajuda consulta medico medica'.split(
    ' ',
  ),
);
export function tokens(value: string) {
  return (
    normalize(value)
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length > 2 && !stopwords.has(token)) ?? []
  );
}

export function redactIdentifiers(value: string) {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[e-mail removido]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento removido]')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9\d{4}[-\s]?\d{4}\b/g, '[telefone removido]');
}
