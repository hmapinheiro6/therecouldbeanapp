import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  catalogResponse,
  type PublishedCatalog,
} from "../../src/lib/static-catalog";
import type { Product, SearchResponse } from "../../src/lib/types";
const data = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const categories = JSON.parse(readFileSync("data/categories.json", "utf8")) as {
  slug: string;
  name: string;
}[];
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
describe("static public catalog", () => {
  it("uses the same 160-character boundary as the live API", () => {
    expect(() =>
      catalogResponse(snapshot, "/search?q=" + "a".repeat(160)),
    ).not.toThrow();
    expect(() =>
      catalogResponse(snapshot, "/search?q=" + "a".repeat(161)),
    ).toThrow("2–160 characters");
  });
  it("retains exact name and verified evidence with publication dates", () => {
    const r = catalogResponse(snapshot, "/search?q=Otter") as SearchResponse & {
      catalog_updated_at: string;
    };
    expect(r.results[0].slug).toBe("otter");
    expect(r.results[0].capabilities.length).toBeGreaterThan(0);
    expect(r.catalog_updated_at).toBe(data.exported_at);
  });
  it("keeps identity-only wording matches related and preserves missing coverage", () => {
    const r = catalogResponse(
      snapshot,
      "/search?q=focus%20timer%20kanban",
    ) as SearchResponse;
    const product = r.results.find((p) => p.name === "TriggerFlo");
    expect(product?.verification_scope).toBe("identity");
    expect(product?.capabilities).toEqual([]);
    expect(product?.match_class).toBe("Related product");
    expect(
      (
        catalogResponse(
          snapshot,
          "/search?q=zzqvzxwqnonexistent",
        ) as SearchResponse
      ).total,
    ).toBe(0);
  });
  it("only provides published reads, with bounded pagination and useful details", () => {
    const page = catalogResponse(snapshot, "/products?sort=recent") as {
      products: Product[];
    };
    expect(page.products).toHaveLength(24);
    expect(
      (catalogResponse(snapshot, "/products/otter") as Product).canonical_url,
    ).toBe("https://otter.ai");
    expect(() => catalogResponse(snapshot, "/admin/queue")).toThrow(
      "private operator access",
    );
    expect(() => catalogResponse(snapshot, "/products?offset=-1")).toThrow();
  });
});
