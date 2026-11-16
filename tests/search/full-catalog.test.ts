import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fullCatalogDatabase } from "../full-catalog";
import { search } from "../db";
import { snapshotResponse, type CatalogSnapshot } from "../../src/lib/snapshot";
import type { Product, SearchResponse } from "../../src/lib/types";
import cases from "../../data/full-catalog-search.json";
import categories from "../../data/categories.json";

const db = fullCatalogDatabase();
afterAll(() => db.close());
const data = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const snapshot: CatalogSnapshot = {
  exported_at: data.exported_at,
  categories: [],
  products: data.products.map((p: Product, id: number) => ({
    ...p,
    id,
    category: categories.find((c) => c.slug === p.category_slug)!.name,
    normalized_domain: new URL(p.canonical_url).hostname,
  })),
};

it("restores the complete public export with its evidence scopes and aliases", () => {
  expect(db.prepare("SELECT count(*) n FROM products").get()?.n).toBe(
    data.products.length,
  );
  expect(db.prepare("SELECT count(*) n FROM product_fts").get()?.n).toBe(
    data.products.length,
  );
  expect(
    db
      .prepare("SELECT search_aliases FROM products WHERE name='Wave Terminal'")
      .get()?.search_aliases,
  ).toContain("WaveTerm");
  const identities = data.products.filter(
    (p: Product) => p.verification_scope === "identity",
  ).length;
  expect(
    db
      .prepare(
        "SELECT count(*) n FROM products WHERE verification_scope='identity'",
      )
      .get()?.n,
  ).toBe(identities);
});

for (const [name, run] of [
  ["SQLite FTS5", (query: string) => search(db, query)],
  [
    "saved public catalog",
    (query: string) =>
      (
        snapshotResponse(
          snapshot,
          "/search?q=" + encodeURIComponent(query),
        ) as SearchResponse
      ).results,
  ],
] as const) {
  describe(name + " judged full-catalog regression sample", () => {
    for (const c of cases.cases) {
      it(c.kind + ": " + c.query, () => {
        const results = run(c.query);
        if (c.first) expect(results[0]?.name).toBe(c.expected_names[0]);
        if (c.expected_names.length)
          expect(
            results
              .slice(0, 10)
              .some((p) => (c.expected_names as string[]).includes(p.name)),
          ).toBe(true);
        if (c.no_strong)
          expect(results.every((p) => p.match_class !== "Strong match")).toBe(
            true,
          );
        if (c.empty) expect(results).toEqual([]);
        for (const slug of c.top_capabilities ?? []) {
          expect(results[0]?.matched.some((cap) => cap.slug === slug)).toBe(
            true,
          );
          expect(
            results[0]?.capabilities.find((cap) => cap.slug === slug)
              ?.evidence_url,
          ).toMatch(/^https:\/\//);
        }
        for (const slug of c.excluded_capabilities ?? [])
          expect(
            results.every(
              (p) => !p.capabilities.some((cap) => cap.slug === slug),
            ),
          ).toBe(true);
        expect(
          results
            .filter((p) => p.verification_scope === "identity")
            .every((p) => p.matched.length === 0),
        ).toBe(true);
      });
    }
  });
}

it("does not retain a stale catalog alias after an edited listing", () => {
  search(db, "WaveTerm");
  db.exec("SAVEPOINT alias_edit");
  try {
    db.prepare(
      "UPDATE products SET search_aliases='RevisedWaveAlias' WHERE name='Wave Terminal'",
    ).run();
    expect(search(db, "RevisedWaveAlias")[0]?.name).toBe("Wave Terminal");
    expect(search(db, "WaveTerm").some((p) => p.name === "Wave Terminal")).toBe(
      false,
    );
  } finally {
    db.exec("ROLLBACK TO alias_edit; RELEASE alias_edit");
  }
  expect(search(db, "WaveTerm")[0]?.name).toBe("Wave Terminal");
});
