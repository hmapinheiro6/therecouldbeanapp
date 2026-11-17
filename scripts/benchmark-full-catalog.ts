import { readFileSync, writeFileSync } from "node:fs";
import { fullCatalogDatabase } from "../tests/full-catalog";
import { search } from "../tests/db";
import {
  catalogResponse,
  type PublishedCatalog,
} from "../src/lib/static-catalog";
import type { Product, SearchResponse, SearchResult } from "../src/lib/types";
import suite from "../data/full-catalog-search.json";
import categories from "../data/categories.json";

const db = fullCatalogDatabase();
const data = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const snapshot: PublishedCatalog = {
  exported_at: data.exported_at,
  categories: [],
  products: data.products.map((p: Product, id: number) => ({
    ...p,
    id,
    category: categories.find((c) => c.slug === p.category_slug)!.name,
    normalized_domain: new URL(p.canonical_url).hostname,
  })),
};
const measure = (run: (query: string) => SearchResult[]) =>
  suite.cases.map((c) => {
    const started = performance.now();
    let results: SearchResult[] = [],
      error: string | null = null;
    try {
      results = run(c.query);
    } catch (e) {
      error = String(e);
    }
    const expected = new Set<string>(c.expected_names);
    const position = results.findIndex((p) => expected.has(p.name));
    const failures = [
      ...(error ? ["search_error"] : []),
      ...(expected.size && (position < 0 || position >= 10)
        ? ["no_expected_top10"]
        : []),
      ...(c.first && position !== 0 ? ["expected_name_not_first"] : []),
      ...(c.no_strong && results.some((p) => p.match_class === "Strong match")
        ? ["unsupported_strong"]
        : []),
      ...(c.empty && results.length ? ["expected_empty"] : []),
      ...(c.top_capabilities?.some(
        (slug) => !results[0]?.matched.some((cap) => cap.slug === slug),
      )
        ? ["top_missing_verified_capability"]
        : []),
      ...(c.excluded_capabilities?.some((slug) =>
        results.some((p) => p.capabilities.some((cap) => cap.slug === slug)),
      )
        ? ["excluded_capability_returned"]
        : []),
      ...(results.some(
        (p) => p.verification_scope === "identity" && p.matched.length,
      )
        ? ["identity_claim_promoted"]
        : []),
    ];
    return {
      query: c.query,
      kind: c.kind,
      expected_names: c.expected_names,
      first_expected_rank: position < 0 ? null : position + 1,
      failures,
      error,
      elapsed_ms: performance.now() - started,
      top_5: results.slice(0, 5).map((p) => ({
        name: p.name,
        slug: p.slug,
        classification: p.match_class,
        matched: p.matched.map((cap) => cap.slug),
      })),
    };
  });
const runs = {
  sqlite_fts5: measure((query) => search(db, query)),
  browser_snapshot: measure(
    (query) =>
      (
        catalogResponse(
          snapshot,
          "/search?q=" + encodeURIComponent(query),
        ) as SearchResponse
      ).results,
  ),
};
const summary = Object.fromEntries(
  Object.entries(runs).map(([name, cases]) => {
    const lookup = cases.filter((c) => c.kind === "name" || c.kind === "alias");
    const supported = cases.filter((c) => c.expected_names.length);
    const latencies = cases.map((c) => c.elapsed_ms).sort((a, b) => a - b);
    return [
      name,
      {
        cases: cases.length,
        passed_cases: cases.filter((c) => !c.failures.length).length,
        expected_top10_cases: supported.filter(
          (c) => c.first_expected_rank !== null && c.first_expected_rank <= 10,
        ).length,
        judged_expected_cases: supported.length,
        name_alias_first: lookup.filter((c) => c.first_expected_rank === 1)
          .length,
        name_alias_cases: lookup.length,
        local_latency_p50_ms: latencies[Math.floor(latencies.length * 0.5)],
        local_latency_p95_ms: latencies[Math.floor(latencies.length * 0.95)],
        failures: cases
          .filter((c) => c.failures.length)
          .map((c) => ({ query: c.query, failures: c.failures })),
      },
    ];
  }),
);
const report = {
  measured_at: new Date().toISOString(),
  exported_at: data.exported_at,
  catalog_products: Number(
    db.prepare("SELECT count(*) n FROM products WHERE status='published'").get()
      ?.n,
  ),
  judgment_method: suite.judgment_method,
  limitations: [
    "Single-author regression judgments; neither a blind relevance assessment nor comprehensive precision/recall.",
    "Lexical matches reflect saved directory wording and are not feature evidence.",
    "Local Node timings do not measure deployed Worker CPU, D1 billed reads, or browser-device performance.",
    "SQLite is an offline legacy FTS5 comparison; production uses the independently evaluated MiniSearch browser index.",
  ],
  summary,
  runs,
};
const output = process.argv[2] ?? "docs/full-catalog-search-results.json";
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    { catalog_products: report.catalog_products, summary, output },
    null,
    2,
  ),
);
db.close();
if (
  Object.values(summary).some((result) => result.passed_cases !== result.cases)
)
  process.exitCode = 1;
