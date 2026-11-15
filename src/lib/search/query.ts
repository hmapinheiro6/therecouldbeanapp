import synonyms from "../../../data/synonyms.json";
import capabilities from "../../../data/capabilities.json";
const filler = new Set(
  "i was thinking of making an a the that to my me our we want build app application tool software helps help for with and or it need would like something can could be in on is are automatically".split(
    " ",
  ),
);
const corrections: Record<string, string> = {
  invocing: "invoicing",
  invoicng: "invoicing",
  calender: "calendar",
  schedueling: "scheduling",
  transcribtion: "transcription",
  managment: "management",
  freelancres: "freelancers",
  costumer: "customer",
  crms: "crm",
  salespeople: "sales contacts",
  followup: "follow up",
};
export function normalize(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => corrections[w] ?? w)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
}
// Immutable vocabulary preprocessing avoids hundreds of repeated normalizations per request.
const normalizedSynonyms = Object.entries(synonyms).map(
  ([slug, aliases]) =>
    [slug, aliases.map((a) => " " + normalize(a) + " ")] as const,
);
const capabilityMap = new Map(
  capabilities.map((c) => [
    c.slug,
    { ...c, words: normalize(c.name).split(" ") },
  ]),
);
const generic = new Set(
  "please find way something manage business work solution platform across online more create generate sends send extracts extract track tracks tracking handle handles from into turns turn lets let get teams team just simple useful using use remember who again".split(
    " ",
  ),
);
const singular = (word: string) =>
  word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
const capabilityWords = new Map(
  normalizedSynonyms.map(([slug, aliases]) => [
    slug,
    [...new Set(aliases.flatMap((a) => a.trim().split(" ").map(singular)))],
  ]),
);
export interface Intent {
  normalized: string;
  tokens: string[];
  capabilities: string[];
  excluded: string[];
  qualifiers: string[];
  audience: string[];
  fts: string;
}
export function parseQuery(query: string): Intent {
  const normalized = normalize(query);
  const chunks = normalized.split(/\b(?:but|however)\b/);
  const positive: string[] = [];
  const negative: string[] = [];
  for (const chunk of chunks) {
    const parts = chunk.split(
      /\b(?:without|not|no|excluding|except|dont|doesnt)\b/,
    );
    positive.push(parts[0]);
    if (parts.length > 1) negative.push(parts.slice(1).join(" "));
  }
  const has = (text: string, phrase: string) =>
    (" " + text + " ").includes(" " + phrase + " ");
  const extract = (text: string) => {
    const padded = " " + text + " ";
    return normalizedSynonyms
      .filter(([, aliases]) => aliases.some((a) => padded.includes(a)))
      .map(([s]) => s);
  };
  const excluded = extract(negative.join(" "));
  const requested = extract(positive.join(" ")).filter(
    (s) => !excluded.includes(s),
  );
  // A bare pipeline is ambiguous: no automatic CRM/CI/data expansion.
  const words = positive
    .join(" ")
    .split(" ")
    .filter((w) => w.length > 1 && !filler.has(w))
    .slice(0, 20);
  const qualifiers = [
    "offline",
    "self hosted",
    "open source",
    "free",
    "encrypted",
    "end to end",
    "hipaa",
    "gdpr",
    "ai",
  ].filter((q) => has(normalized, q));
  const audience = [
    "freelancer",
    "freelancers",
    "designer",
    "designers",
    "developers",
    "sales",
    "teachers",
    "students",
    "healthcare",
    "lawyers",
    "dentists",
    "restaurants",
  ].filter((q) => has(normalized, q));
  // Unknown nouns may describe essential requirements outside our taxonomy.
  // Keep them visible and prevent a category-only match from becoming "strong".
  const knownWords = new Set(
    requested.flatMap((slug) => capabilityWords.get(slug) ?? []),
  );
  const qualifiedWords = new Set(
    [...qualifiers, ...audience].flatMap((q) => q.split(" ")),
  );
  const unknown = requested.length
    ? words.filter(
        (w) =>
          !knownWords.has(singular(w)) &&
          !generic.has(w) &&
          !qualifiedWords.has(w),
      )
    : [];
  if (unknown.length)
    qualifiers.push(
      ...[...new Set(unknown)].slice(0, 6).map((w) => "“" + w + "”"),
    );
  const expanded = requested.flatMap((s) => {
    return capabilityMap.get(s)?.words ?? [];
  });
  const tokens = [...new Set([...words, ...expanded])].slice(0, 40);
  const fts = tokens.map((t) => '"' + t.replace(/"/g, "") + '"').join(" OR ");
  return {
    normalized,
    tokens: words,
    capabilities: requested,
    excluded,
    qualifiers,
    audience,
    fts,
  };
}
export const capabilityName = (slug: string) =>
  capabilityMap.get(slug)?.name ?? slug;
