import { beforeAll, afterAll, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fullCatalogDatabase } from "../full-catalog";
import { assembleExport, EXPORT_QUERIES } from "../../scripts/published-export";
let db: DatabaseSync;
const snapshot = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const expectedProducts = snapshot.products.length;
const expectedClaims = snapshot.products.reduce(
  (n: number, p: { capabilities: unknown[] }) => n + p.capabilities.length,
  0,
);
beforeAll(() => {
  db = fullCatalogDatabase();
}, 60000);
afterAll(() => db?.close());
function exported() {
  return EXPORT_QUERIES.map((sql) => ({
    success: true,
    results: db.prepare(sql).all(),
    meta: { rows_read: 10_000 },
  }));
}
it("exports the actual catalog through four linear plans with indexed provenance hydration", () => {
  for (const query of EXPORT_QUERIES) {
    const plans = db
      .prepare("EXPLAIN QUERY PLAN " + query)
      .all()
      .map((p) => String(p.detail));
    expect(plans.join(" ")).not.toMatch(/CORRELATED|SCALAR SUBQUERY/);
  }
  const sourcePlan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM product_sources WHERE product_id IN (1,2,3)",
    )
    .all()
    .map((p) => String(p.detail))
    .join(" ");
  expect(sourcePlan).toContain("product_sources_product");
  const restored = assembleExport(exported(), expectedProducts);
  expect(restored.products).toHaveLength(expectedProducts);
  expect(restored.claims).toBe(expectedClaims);
  expect(restored.rowsRead).toBe(40000);
  expect(JSON.stringify(restored.products)).not.toMatch(
    /contact_email|review_draft_json|admin_sessions/,
  );
});
it("rejects partial, unaccounted, over-budget and unexpectedly shrunken exports", () => {
  expect(() =>
    assembleExport(exported().slice(0, 3), expectedProducts),
  ).toThrow(/Incomplete/);
  const failed = exported();
  failed[1].success = false;
  expect(() => assembleExport(failed, expectedProducts)).toThrow(/Incomplete/);
  const noAccounting = exported();
  delete (noAccounting[0] as { meta?: unknown }).meta;
  expect(() => assembleExport(noAccounting, expectedProducts)).toThrow(
    /accounting/,
  );
  expect(() => assembleExport(exported(), expectedProducts, 100)).toThrow(
    /budget/,
  );
  const shrunk = exported();
  shrunk[0].results = shrunk[0].results.slice(0, 100);
  expect(() => assembleExport(shrunk, expectedProducts)).toThrow(/smaller/);
  const noSources = exported();
  noSources[2].results = [];
  expect(() => assembleExport(noSources, expectedProducts)).toThrow(
    /provenance/,
  );
});
