import { MAX_QUERY_LENGTH } from "./search/limits";
import { normalize, parseQuery } from "./search/query";
import { rank, verdict } from "./search/rank";
import type { Product } from "./types";
export type CatalogSnapshot = {
  exported_at: string;
  categories: { slug: string; name: string; product_count: number }[];
  products: (Product & { search_aliases?: string })[];
};
let saved: Promise<CatalogSnapshot> | undefined;
export function snapshotResponse(snapshot: CatalogSnapshot, path: string) {
  const url = new URL(path, "https://snapshot.invalid"),
    snapshot_at = snapshot.exported_at;
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    throw new Error("Invalid catalog page.");
  if (url.pathname === "/stats")
    return {
      products: snapshot.products.length,
      catalog_updated_at: snapshot_at,
      snapshot_at,
    };
  if (url.pathname === "/categories")
    return { categories: snapshot.categories, snapshot_at };
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
      snapshot_at,
    };
  }
  if (url.pathname.startsWith("/products/")) {
    const product = snapshot.products.find(
      (p) => p.slug === decodeURIComponent(url.pathname.slice(10)),
    );
    if (!product) throw new Error("This app is not in the saved catalog.");
    return { ...product, snapshot_at };
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
    const candidates = snapshot.products
      .flatMap((p) => {
        const text = normalize(
          [
            p.name,
            p.short_description,
            p.audience,
            p.category,
            p.search_aliases,
            ...p.capabilities.map((c) => c.name),
          ].join(" "),
        );
        const words = new Set(text.split(" "));
        const hits = terms.filter((t) => words.has(t)).length;
        const features = p.capabilities.filter((c) =>
          intent.capabilities.includes(c.slug),
        ).length;
        return hits || features
          ? [
              {
                ...p,
                bm25: 0,
                retrieval:
                  hits +
                  features * 5 +
                  (normalize(p.name) === intent.normalized ? 100 : 0),
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
      catalog_updated_at: snapshot_at,
      elapsed_ms: Math.round(performance.now() - started),
      snapshot_at,
    };
  }
  throw new Error(
    "This action needs the live database. Try again after its daily allowance resets.",
  );
}
export async function snapshotApi(path: string, signal?: AbortSignal) {
  if (!saved)
    saved = fetch("/catalog-backup.json")
      .then((r) => {
        if (!r.ok) throw new Error("The saved catalog is unavailable.");
        return r.json() as Promise<CatalogSnapshot>;
      })
      .catch((e) => {
        saved = undefined;
        throw e;
      });
  const snapshot = await saved;
  signal?.throwIfAborted();
  return snapshotResponse(snapshot, path);
}
