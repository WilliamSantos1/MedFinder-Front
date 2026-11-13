import { normalize } from './text.js';

const noise = new Set([
  'saude',
  'plano',
  'de',
  'assistencia',
  'medica',
  'beneficio',
  'rede',
  'vale',
]);
const key = (value: string) => normalize(value).replace(/[^a-z0-9]/g, '');
const pattern = (value: string) => new RegExp(`\\b${[...key(value)].join('[\\s.\\-]*')}\\b`, 'g');

/** Names and unambiguous short forms come exclusively from the visible catalog. */
export function resolveInsurances(message: string, options: string[]) {
  const text = normalize(message);
  const aliases = new Map<string, Set<string>>();
  for (const name of options) {
    const short = normalize(name)
      .split(/[^a-z0-9]+/)
      .filter((word) => word && !noise.has(word))
      .join(' ');
    for (const alias of [name, short]) {
      if (key(alias).length < 2) continue;
      const plans = aliases.get(key(alias)) ?? new Set<string>();
      plans.add(name);
      aliases.set(key(alias), plans);
    }
  }
  const occurrences = [...aliases].flatMap(([alias, names]) =>
    [...text.matchAll(pattern(alias))]
      // A clinic brand alone is not an assertion about the insurance it accepts.
      .filter((match) => !/\b(?:clinica|hospital|unidade)\s+$/.test(text.slice(0, match.index)))
      .map((match) => ({ start: match.index, end: match.index + match[0].length, names })),
  );
  const longest = occurrences.filter(
    (match) =>
      !occurrences.some(
        (other) =>
          other.start <= match.start &&
          other.end >= match.end &&
          other.end - other.start > match.end - match.start,
      ),
  );
  const matches = [...new Set(longest.flatMap((match) => [...match.names]))];
  const ambiguous = longest.some((match) => match.names.size > 1);
  const remainder = longest
    .reduce(
      (result, match) => {
        for (let index = match.start; index < match.end; index++) result[index] = ' ';
        return result;
      },
      [...text],
    )
    .join('')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const planOnly =
    matches.length > 0 &&
    /^(?:(?:e|a|o|da|do|pela|pelo|com|qual|quanto|ao|sobre|plano|convenio|de|saude)\s*)*$/.test(
      remainder,
    );
  return { matches, ambiguous, planOnly };
}

/** A new, unidentified plan must never fall back to a previously selected plan. */
export function hasUnrecognizedInsurance(message: string, options: string[]) {
  const text = normalize(message);
  const noun =
    /\b(?:plano|convenio|operadora|carteirinha|aceit\w*)\s+(?:de saude\s+)?(?:(?:do|da|o|a)\s+)?(.+)/g;
  for (const match of text.matchAll(noun)) {
    const candidate = match[1]
      .replace(/^e\s+/, '')
      .split(/[?!,;.]|\b(?:em|para|nessas|dessas|destas|entre)\b/)[0]
      .trim();
    if (
      !candidate ||
      /^(?:meu|minha|dele|dela|isso|esse|essa|mesmo|mesma|selecionado|selecionada|anterior|atual|que|aceit\w*|atend\w*|cobr\w*|ou\b)/.test(
        candidate,
      )
    )
      continue;
    if (!resolveInsurances(candidate, options).matches.length) return true;
  }
  return false;
}
