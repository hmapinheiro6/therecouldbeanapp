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
    (" " + text + " ").includes(" " + normalize(phrase) + " ");
  const extract = (text: string) =>
    Object.entries(synonyms)
      .filter(([, aliases]) => aliases.some((a) => has(text, a)))
      .map(([s]) => s);
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
  const expanded = requested.flatMap((s) => {
    const c = capabilities.find((c) => c.slug === s);
    return c ? normalize(c.name).split(" ") : [];
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
  capabilities.find((c) => c.slug === slug)?.name ?? slug;
