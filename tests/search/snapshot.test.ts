import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { snapshotResponse, type CatalogSnapshot } from "../../src/lib/snapshot";
import type { Product, SearchResponse } from "../../src/lib/types";
const data = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const categories = JSON.parse(readFileSync("data/categories.json", "utf8")) as {
  slug: string;
  name: string;
}[];
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
describe("public catalog recovery", () => {
  it("retains exact name and verified evidence while marking snapshot results", () => {
    const r = snapshotResponse(
      snapshot,
      "/search?q=Otter",
    ) as SearchResponse & { snapshot_at: string };
    expect(r.results[0].slug).toBe("otter");
    expect(r.results[0].capabilities.length).toBeGreaterThan(0);
    expect(r.snapshot_at).toBe(data.exported_at);
  });
  it("keeps identity-only wording matches related and preserves missing coverage", () => {
    const r = snapshotResponse(
      snapshot,
      "/search?q=focus%20timer%20kanban",
    ) as SearchResponse;
    const product = r.results.find((p) => p.name === "TriggerFlo");
    expect(product?.verification_scope).toBe("identity");
    expect(product?.capabilities).toEqual([]);
    expect(product?.match_class).toBe("Related product");
    expect(
      (
        snapshotResponse(
          snapshot,
          "/search?q=zzqvzxwqnonexistent",
        ) as SearchResponse
      ).total,
    ).toBe(0);
  });
  it("only provides published reads, with bounded pagination and useful details", () => {
    const page = snapshotResponse(snapshot, "/products?sort=recent") as {
      products: Product[];
    };
    expect(page.products).toHaveLength(24);
    expect(
      (snapshotResponse(snapshot, "/products/otter") as Product).canonical_url,
    ).toBe("https://otter.ai");
    expect(() => snapshotResponse(snapshot, "/admin/queue")).toThrow(
      "live database",
    );
    expect(() => snapshotResponse(snapshot, "/products?offset=-1")).toThrow();
  });
});
