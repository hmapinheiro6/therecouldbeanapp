import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parse } from "jsonc-parser";
import MiniSearch from "minisearch";
import { SEARCH_OPTIONS } from "../src/lib/static-catalog.ts";
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const expected = ["/api/admin/*", "/api/internal/*", "/api/submit"];
if (JSON.stringify(config.assets.run_worker_first) !== JSON.stringify(expected))
  throw new Error("Ordinary public routes must bypass the Worker");
const catalog = JSON.parse(readFileSync("dist/catalog/products.json", "utf8"));
const search = MiniSearch.loadJSON(
  JSON.stringify(
    JSON.parse(readFileSync("dist/catalog/search.json", "utf8")).index,
  ),
  SEARCH_OPTIONS,
);
if (search.documentCount !== catalog.products.length)
  throw new Error("Search index is incomplete");
const sitemap = readFileSync("dist/sitemap.xml", "utf8");
for (const product of catalog.products) {
  const path = "dist/apps/" + product.slug + ".html";
  if (!existsSync(path)) throw new Error("Missing static product page");
  const html = readFileSync(path, "utf8");
  if (
    !html.includes('id="catalog-product"') ||
    !html.includes("application/ld+json") ||
    !sitemap.includes("/apps/" + product.slug + "<")
  )
    throw new Error("Incomplete product HTML or sitemap");
  if ((html.match(/rel="canonical"/g) ?? []).length !== 1)
    throw new Error("Product canonical is not unique");
}
for (const path of [
  "dist/catalog-backup.json",
  "dist/catalog-pages",
  "dist/catalog-backup-sitemap.xml",
  "dist/catalog-intelligence",
])
  if (existsSync(path))
    throw new Error("Retired recovery/per-product observation asset remains");
const bundleFiles = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
for (const file of bundleFiles) {
  const text = readFileSync("dist/assets/" + file, "utf8");
  if (/\/api\/(?:previews|intelligence|search)/.test(text))
    throw new Error("Public browser bundle still calls a Worker endpoint");
}
console.log(
  JSON.stringify({
    static_release: "verified",
    products: catalog.products.length,
    worker_routes: expected,
  }),
);
