import { writeFileSync, readFileSync } from "node:fs";
import { database, search } from "../tests/db";
import suite from "../data/benchmark.json";
const db = database();
const records = suite.cases.map((c) => {
  const start = performance.now();
  const cpu = process.cpuUsage();
  const result = search(db, c.query);
  const latency = performance.now() - start;
  const cpuUsed = process.cpuUsage(cpu);
  const cpuMs = (cpuUsed.user + cpuUsed.system) / 1000;
  const expected = new Set(c.expected_products);
  const inCatalog = c.expected_products.filter(
    (s) =>
      !!db
        .prepare("SELECT 1 FROM products WHERE slug=? AND status='published'")
        .get(s),
  );
  const relevant = result.map((p) => expected.has(p.slug));
  const found = result.slice(0, 10).filter((p) => expected.has(p.slug));
  const rank = result.findIndex((p) => expected.has(p.slug));
  const unsupported = result.filter(
    (p) =>
      p.match_class === "Strong match" &&
      (p.missing.length > 0 || c.max_strong === 0),
  );
  return {
    id: c.id,
    query: c.query,
    kind: c.kind,
    known_relevant: expected.size,
    in_catalog: inCatalog.length,
    precision_at_5: relevant.slice(0, 5).filter(Boolean).length / 5,
    precision_of_returned_top5: result.length
      ? relevant.slice(0, 5).filter(Boolean).length / Math.min(5, result.length)
      : 0,
    recall_at_10: inCatalog.length ? found.length / inCatalog.length : null,
    reciprocal_rank: rank >= 0 ? 1 / (rank + 1) : 0,
    capability_coverage:
      result[0] && c.capabilities.length
        ? result[0].matched.length / c.capabilities.length
        : null,
    unsupported_strong: unsupported.length,
    irrelevant_hits: result
      .slice(0, 5)
      .filter((p) => (c.important_irrelevant as string[]).includes(p.slug))
      .map((p) => p.slug),
    latency_ms: latency,
    cpu_ms: cpuMs,
    top_5: result
      .slice(0, 5)
      .map((p) => ({ slug: p.slug, classification: p.match_class })),
  };
});
const supported = records.filter((r) => r.in_catalog > 0);
const mean = (a: number[]) => a.reduce((s, n) => s + n, 0) / (a.length || 1);
const quantile = (a: number[], q: number) =>
  [...a].sort((a, b) => a - b)[
    Math.min(a.length - 1, Math.floor(a.length * q))
  ];
const capacity = [];
for (const size of [1000, 10000]) {
  const snapshot = readFileSync("data/seeds/catalog.json", "utf8");
  const samples = JSON.parse(snapshot) as {
    name: string;
    canonical_url: string;
    short_description: string;
    category_slug: string;
    audience: string;
  }[];
  db.exec("SAVEPOINT capacity");
  const insert = db.prepare(
    "INSERT INTO products(slug,name,canonical_url,normalized_domain,short_description,category_id,audience,status,first_seen_at,last_verified_at) VALUES(?,?,?,?,?,(SELECT id FROM categories WHERE slug=?),?,'published',datetime('now'),datetime('now'))",
  );
  for (let i = 0; i < size; i++) {
    const p = samples[i % samples.length];
    insert.run(
      "synthetic-" + i,
      p.name + " synthetic " + i,
      "https://synthetic.invalid/" + i,
      "synthetic.invalid",
      p.short_description,
      p.category_slug,
      p.audience,
    );
  }
  const times: number[] = [],
    cpus: number[] = [];
  for (let i = 0; i < 60; i++) {
    const before = performance.now(),
      cpu = process.cpuUsage();
    search(db, suite.cases[i % suite.cases.length].query);
    times.push(performance.now() - before);
    const used = process.cpuUsage(cpu);
    cpus.push((used.user + used.system) / 1000);
  }
  capacity.push({
    synthetic_products: size,
    description:
      "Synthetic lexical load only. Not published catalog records. Capability join work remains bounded to 80 candidates.",
    latency_p50_ms: quantile(times, 0.5),
    latency_p95_ms: quantile(times, 0.95),
    node_cpu_p95_ms: quantile(cpus, 0.95),
  });
  db.exec("ROLLBACK TO capacity; RELEASE capacity");
}
const report = {
  measured_at: new Date().toISOString(),
  environment:
    "Node 24 SQLite FTS5, local process. NOT deployed Worker CPU or D1 billing measurements.",
  catalog_products: db.prepare("SELECT count(*) n FROM products").get()?.n,
  case_count: records.length,
  supported_cases: supported.length,
  metrics: {
    precision_at_5: mean(supported.map((r) => r.precision_at_5)),
    judgment_ceiling_precision_at_5: mean(
      supported.map((r) => Math.min(5, r.in_catalog) / 5),
    ),
    precision_of_returned_top5: mean(
      supported.map((r) => r.precision_of_returned_top5),
    ),
    recall_at_10: mean(supported.map((r) => r.recall_at_10 ?? 0)),
    mrr: mean(supported.map((r) => r.reciprocal_rank)),
    mean_top_result_capability_coverage: mean(
      supported.flatMap((r) =>
        r.capability_coverage === null ? [] : [r.capability_coverage],
      ),
    ),
    unsupported_strong: records.reduce((s, r) => s + r.unsupported_strong, 0),
    latency_p50_ms: quantile(
      records.map((r) => r.latency_ms),
      0.5,
    ),
    latency_p95_ms: quantile(
      records.map((r) => r.latency_ms),
      0.95,
    ),
  },
  targets: { precision_at_5: 0.8, recall_at_10: 0.85 },
  limitations: [
    "Single-author engineering judgments; external blind evaluation still needed.",
    "The fixed relevant-product judgments impose a calculable P@5 ceiling; expand independently verified judgments and catalog coverage before interpreting the 80% target as a ranking-only requirement.",
    "Strict Precision@5 uses five slots; the additional returned-result precision uses min(5, returned). Many supported categories have fewer than five known catalog products.",
    "Recall is within manually known relevant products present in catalog; not the entire market.",
    "Capacity copies have no new capability evidence and are explicitly synthetic.",
    "Local timing does not establish Worker CPU or D1 billing; separate production measurements are recorded in docs/production-search-cpu.json and docs/production-d1-measurement.json.",
  ],
  capacity,
  cases: records,
};
writeFileSync(
  "docs/benchmark-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
db.close();
