import type { Product, SearchResult } from "../types";
import { capabilityName, normalize, type Intent } from "./query";
export const WEIGHTS = {
  coverage: 100,
  missing: 20,
  bm25: 6,
  exactName: 130,
  phrase: 15,
  audience: 8,
  category: 5,
};
export function rank(
  products: (Product & { bm25: number })[],
  intent: Intent,
): SearchResult[] {
  return products
    .map((p) => {
      const matched = p.capabilities.filter((c) =>
        intent.capabilities.includes(c.slug),
      );
      const missing = intent.capabilities.filter(
        (s) => !matched.some((c) => c.slug === s),
      );
      const coverage = intent.capabilities.length
        ? matched.length / intent.capabilities.length
        : 0;
      const exact = normalize(p.name) === intent.normalized;
      const text = normalize(`${p.name} ${p.short_description} ${p.audience}`);
      const audience = intent.audience.some((a) =>
        normalize(p.audience).includes(a),
      );
      const category = intent.tokens.some((t) =>
        normalize(p.category).includes(t),
      );
      const excluded = p.capabilities.some((c) =>
        intent.excluded.includes(c.slug),
      );
      const unknownQualifier = intent.qualifiers.length > 0;
      const lexical = intent.tokens.filter((t) =>
        text.split(" ").includes(t),
      ).length;
      const score =
        coverage * WEIGHTS.coverage -
        missing.length * WEIGHTS.missing +
        Math.min(1, Math.abs(p.bm25)) * WEIGHTS.bm25 +
        (exact ? WEIGHTS.exactName : 0) +
        (text.includes(intent.normalized) ? WEIGHTS.phrase : 0) +
        (audience ? WEIGHTS.audience : 0) +
        (category ? WEIGHTS.category : 0) +
        Math.min(lexical, 5) -
        (excluded ? 100 : 0);
      const strong =
        !excluded &&
        !unknownQualifier &&
        (exact ||
          (intent.capabilities.length > 0 &&
            coverage === 1 &&
            (!intent.audience.length || audience)));
      const match_class = strong
        ? "Strong match"
        : matched.length > 0 && !excluded
          ? "Partial match"
          : "Related product";
      const concerns = [
        ...missing.map(capabilityName),
        ...intent.qualifiers.map((q) => `${q} requirement`),
        ...(!audience && intent.audience.length
          ? [`${intent.audience.join("/")} audience`]
          : []),
      ];
      const explanation =
        (matched.length
          ? `Matches ${matched.map((c) => c.name.toLowerCase()).join(", ")}.`
          : exact
            ? "Found by product name."
            : "Related by catalog wording; core functionality is not established.") +
        (concerns.length
          ? ` ${concerns.join(", ")} could not be verified.`
          : "") +
        (excluded ? " Supports functionality you asked to exclude." : "");
      return {
        ...p,
        score,
        match_class,
        matched,
        missing: concerns,
        explanation,
      } as SearchResult;
    })
    .filter(
      (p) => !p.capabilities.some((c) => intent.excluded.includes(c.slug)),
    )
    .filter(
      (p) =>
        p.matched.length > 0 ||
        normalize(p.name) === intent.normalized ||
        p.score > 0,
    )
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
export function verdict(strong: number, partial: number, related: number) {
  return strong >= 4
    ? "Well, this is awkward."
    : strong > 0
      ? "Someone got there first."
      : partial + related > 0
        ? "You’re not alone."
        : "We couldn't find a close match.";
}
