import MiniSearch from "minisearch";
import { MAX_QUERY_LENGTH } from "./search/limits";
import { normalize, parseQuery } from "./search/query";
import { rank, verdict } from "./search/rank";
import type { Product } from "./types";
export type PublishedCatalog = {
  exported_at: string;
  categories: { slug: string; name: string; product_count: number }[];
  products: (Product & { search_aliases?: string })[];
};
let saved: Promise<PublishedCatalog> | undefined;
let searchIndex:
  Promise<{ exported_at: string; index: MiniSearch }> | undefined;
export const SEARCH_OPTIONS = {
  fields: [
    "name",
    "description",
    "audience",
    "category",
    "aliases",
    "capabilities",
  ],
  tokenize: (text: string) => normalize(text).split(" ").filter(Boolean),
  processTerm: (term: string) => term,
};
export function buildSearchIndex(products: PublishedCatalog["products"]) {
  const index = new MiniSearch(SEARCH_OPTIONS);
  index.addAll(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.short_description,
      audience: p.audience,
      category: p.category,
      aliases: p.search_aliases ?? "",
      capabilities: p.capabilities.map((c) => c.name).join(" "),
    })),
  );
  return index;
}
const indexes = new WeakMap<PublishedCatalog, MiniSearch>();
export function catalogResponse(
  snapshot: PublishedCatalog,
  path: string,
  suppliedIndex?: MiniSearch,
) {
  const url = new URL(path, "https://snapshot.invalid"),
    catalog_updated_at = snapshot.exported_at;
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    throw new Error("Invalid catalog page.");
  if (url.pathname === "/stats")
    return {
      products: snapshot.products.length,
      catalog_updated_at,
    };
  if (url.pathname === "/categories")
    return { categories: snapshot.categories, catalog_updated_at };
  if (url.pathname === "/products") {
    const category = url.searchParams.get("category") ?? "",
      sort = url.searchParams.get("sort") ?? "name";
    const products = snapshot.products
      .filter((p) => !category || p.category_slug === category)
      .sort(
        sort === "recent"
          ? (a, b) =>
              b.first_seen_at.localeCompare(a.first_seen_at) || b.id - a.id
          : (a, b) => a.name.localeCompare(b.name) || a.id - b.id,
      );
    return {
      products: products.slice(offset, offset + 24),
      offset,
      limit: 24,
      catalog_updated_at,
    };
  }
  if (url.pathname.startsWith("/products/")) {
    const product = snapshot.products.find(
      (p) => p.slug === decodeURIComponent(url.pathname.slice(10)),
    );
    if (!product) throw new Error("This app is not in the published catalog.");
    return { ...product, catalog_updated_at };
  }
  if (url.pathname === "/search") {
    const started = performance.now(),
      q = (url.searchParams.get("q") ?? "").trim(),
      intent = parseQuery(q);
    if (
      q.length < 2 ||
      q.length > MAX_QUERY_LENGTH ||
      !intent.fts ||
      offset > 60
    )
      throw new Error(
        `Describe an idea using 2–${MAX_QUERY_LENGTH} characters and a valid page.`,
      );
    const terms = [...intent.fts.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    let index = suppliedIndex ?? indexes.get(snapshot);
    if (!index) {
      index = buildSearchIndex(snapshot.products);
      indexes.set(snapshot, index);
    }
    const hits = new Map(
      index
        .search(terms.join(" "), {
          combineWith: "OR",
          prefix: false,
          boost: { name: 8, aliases: 5, capabilities: 5 },
        })
        .map((r) => [r.id as number, r.score]),
    );
    // Verified feature retrieval remains independent of publisher marketing text.
    const candidates = snapshot.products
      .flatMap((p) => {
        const features = p.capabilities.filter((c) =>
          intent.capabilities.includes(c.slug),
        ).length;
        const lexical = hits.get(p.id) ?? 0;
        return lexical || features
          ? [
              {
                ...p,
                bm25: 0,
                retrieval:
                  lexical +
                  features * 5 +
                  (normalize(p.name) === intent.normalized ? 10000 : 0),
              },
            ]
          : [];
      })
      .sort((a, b) => b.retrieval - a.retrieval)
      .slice(0, 80)
      .map(({ retrieval, ...p }) => {
        void retrieval;
        return p;
      });
    const results = rank(candidates, intent),
      summary = {
        strong: results.filter((p) => p.match_class === "Strong match").length,
        partial: results.filter((p) => p.match_class === "Partial match")
          .length,
        related: results.filter((p) => p.match_class === "Related product")
          .length,
      };
    return {
      query: q,
      requested: intent.capabilities,
      qualifiers: intent.qualifiers,
      summary,
      verdict: verdict(summary.strong, summary.partial, summary.related),
      results: results.slice(offset, offset + 20),
      total: results.length,
      offset,
      limit: 20,
      candidate_limit: 80,
      catalog_updated_at,
      elapsed_ms: Math.round(performance.now() - started),
    };
  }
  throw new Error("This action requires private operator access.");
}
function catalogData() {
  saved ??= fetch("/catalog/products.json", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error("The catalog could not be loaded.");
      return r.json() as Promise<PublishedCatalog>;
    })
    .catch((e) => {
      saved = undefined;
      throw e;
    });
  return saved;
}
function catalogIndex() {
  searchIndex ??= fetch("/catalog/search.json", { cache: "no-cache" })
    .then(async (r) => {
      if (!r.ok) throw new Error("The search index could not be loaded.");
      const value = (await r.json()) as { exported_at: string; index: unknown };
      return {
        exported_at: value.exported_at,
        index: MiniSearch.loadJSON(JSON.stringify(value.index), SEARCH_OPTIONS),
      };
    })
    .catch((e) => {
      searchIndex = undefined;
      throw e;
    });
  return searchIndex;
}
export async function catalogApi(path: string, signal?: AbortSignal) {
  let snapshot: PublishedCatalog, index: MiniSearch | undefined;
  if (path.startsWith("/search?")) {
    let cohort = await Promise.all([catalogData(), catalogIndex()]);
    if (cohort[0].exported_at !== cohort[1].exported_at) {
      saved = undefined;
      searchIndex = undefined;
      cohort = await Promise.all([catalogData(), catalogIndex()]);
      if (cohort[0].exported_at !== cohort[1].exported_at)
        throw new Error("A new catalog is deploying. Try again in a moment.");
    }
    snapshot = cohort[0];
    index = cohort[1].index;
  } else snapshot = await catalogData();
  signal?.throwIfAborted();
  const result = catalogResponse(snapshot, path, index);
  return result;
}
