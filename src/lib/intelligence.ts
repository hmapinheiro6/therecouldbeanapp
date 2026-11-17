/** Small, allowlisted public record parser shared by browser and Worker. */
export const websiteStates = [
  "reachable",
  "restricted",
  "unreachable",
  "identity_unconfirmed",
  "unknown",
] as const;
export type WebsiteState = (typeof websiteStates)[number];
const factKeys = [
  "publication",
  "publisher_update",
  "version",
  "changelog_entry",
  "repository_created",
  "repository_archived",
  "earliest_release",
  "latest_release",
] as const;
type FactKey = (typeof factKeys)[number];
export interface IntelligenceFact {
  source_url: string;
  observed_at: string;
  kind: "publisher_reported" | "repository_metadata" | "public_release";
  date?: string;
  value?: string | boolean;
}
export interface ProductIntelligence {
  version: 1;
  slug: string;
  canonical_url: string;
  first_observed_at: string;
  checked_at: string;
  enriched_at: string | null;
  website: {
    state: WebsiteState;
    source_url: string;
    http_status: number | null;
    last_reachable_at: string | null;
    failed_observation_days: number;
  };
  facts: Partial<Record<FactKey, IntelligenceFact>>;
  checks: { date: string; state: WebsiteState }[];
  history: {
    observed_at: string;
    kind: FactKey | "website";
    value: string;
    source_url: string;
  }[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const url = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) &&
      !/^[\d.]+$/.test(u.hostname) &&
      !/\.(local|internal|localhost|test|invalid|example|onion)$/.test(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
};
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 40 &&
  /^\d{4}-\d\d-\d\dT/.test(v) &&
  Number.isFinite(Date.parse(v));
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\d$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const plain = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 80 &&
  !/[<>]/.test(v) &&
  !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const state = (v: unknown): v is WebsiteState =>
  typeof v === "string" && (websiteStates as readonly string[]).includes(v);
const host = (v: string) => new URL(v).hostname.replace(/^www\./, "");
export function parseIntelligence(
  value: unknown,
  slug: string,
): ProductIntelligence | null {
  if (!object(value)) return null;
  const p = value,
    w = p.website;
  if (
    p.version !== 1 ||
    p.slug !== slug ||
    slug.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !url(p.canonical_url) ||
    !timestamp(p.first_observed_at) ||
    !timestamp(p.checked_at) ||
    !(p.enriched_at === null || timestamp(p.enriched_at)) ||
    !object(w) ||
    !state(w.state) ||
    !url(w.source_url) ||
    !(w.last_reachable_at === null || timestamp(w.last_reachable_at)) ||
    !(
      w.http_status === null ||
      (typeof w.http_status === "number" &&
        Number.isInteger(w.http_status) &&
        w.http_status >= 100 &&
        w.http_status <= 599)
    ) ||
    typeof w.failed_observation_days !== "number" ||
    !Number.isInteger(w.failed_observation_days) ||
    w.failed_observation_days < 0 ||
    w.failed_observation_days > 56 ||
    !object(p.facts) ||
    !Array.isArray(p.checks) ||
    p.checks.length > 56 ||
    !Array.isArray(p.history) ||
    p.history.length > 32
  )
    return null;
  const facts: ProductIntelligence["facts"] = {},
    checks: ProductIntelligence["checks"] = [],
    history: ProductIntelligence["history"] = [];
  for (const key of factKeys) {
    const f = p.facts[key];
    if (f === undefined) continue;
    if (
      !object(f) ||
      !url(f.source_url) ||
      !timestamp(f.observed_at) ||
      (f.date !== undefined &&
        (!date(f.date) || f.date > f.observed_at.slice(0, 10))) ||
      (f.value !== undefined && typeof f.value !== "boolean" && !plain(f.value))
    )
      return null;
    const repository = key.startsWith("repository_"),
      release = key.endsWith("_release");
    const kind = repository
      ? "repository_metadata"
      : release
        ? "public_release"
        : "publisher_reported";
    if (
      f.kind !== kind ||
      host(f.source_url) !==
        (repository || release ? "github.com" : host(p.canonical_url))
    )
      return null;
    if (
      key === "repository_archived"
        ? typeof f.value !== "boolean"
        : key === "version"
          ? typeof f.value !== "string"
          : !f.date
    )
      return null;
    facts[key] = {
      source_url: f.source_url,
      observed_at: f.observed_at,
      kind,
      ...(f.date ? { date: f.date as string } : {}),
      ...(f.value !== undefined ? { value: f.value as string | boolean } : {}),
    };
  }
  for (const c of p.checks) {
    if (
      !object(c) ||
      !date(c.date) ||
      !state(c.state) ||
      (checks.length > 0 && c.date <= checks[checks.length - 1].date)
    )
      return null;
    checks.push({ date: c.date, state: c.state });
  }
  for (const e of p.history) {
    if (
      !object(e) ||
      !timestamp(e.observed_at) ||
      !plain(e.value) ||
      !url(e.source_url) ||
      typeof e.kind !== "string" ||
      !["website", ...factKeys].includes(e.kind)
    )
      return null;
    history.push({
      observed_at: e.observed_at,
      kind: e.kind as FactKey | "website",
      value: e.value,
      source_url: e.source_url,
    });
  }
  return {
    version: 1,
    slug,
    canonical_url: p.canonical_url,
    first_observed_at: p.first_observed_at,
    checked_at: p.checked_at,
    enriched_at: p.enriched_at,
    website: {
      state: w.state,
      source_url: w.source_url,
      http_status: w.http_status,
      last_reachable_at: w.last_reachable_at,
      failed_observation_days: w.failed_observation_days,
    },
    facts,
    checks,
    history,
  };
}
export function websiteLabel(p: ProductIntelligence) {
  const s = p.website.state;
  return s === "reachable"
    ? "Website reachable"
    : s === "restricted"
      ? "Automated check restricted"
      : s === "unreachable"
        ? p.website.failed_observation_days >= 3
          ? "Repeatedly unreachable"
          : "Website unreachable at check"
        : s === "identity_unconfirmed"
          ? "Website identity unconfirmed"
          : "Website status unknown";
}
export const observationDate = (v: string) =>
  new Date(v.length === 10 ? v + "T12:00:00Z" : v).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
export const isStale = (p: ProductIntelligence) =>
  Date.now() - Date.parse(p.checked_at) > 14 * 86400_000;
