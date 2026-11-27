// The published catalog is the only input to public HTML and browser search.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { buildSearchIndex } from "../src/lib/static-catalog.ts";
import { intelligenceBucket } from "../src/lib/static-intelligence.ts";
import { parseIntelligence } from "../src/lib/intelligence.ts";
import { validPreview } from "../src/lib/previews.ts";
import { parse } from "jsonc-parser";
import { escapeHtml } from "../worker/seo.ts";
import { renderPage } from "./render-page.tsx";
import { catalogResponse } from "../src/lib/static-catalog.ts";
import {
  catalogPath,
  pageMetadata,
  pageStructuredData,
  SITE_NAME,
} from "../src/lib/seo.ts";
const base = new URL(
  parse(readFileSync("wrangler.jsonc", "utf8")).vars.SITE_URL,
).origin;
// All routes receive one consistent metadata set, derived from the same content.
const template = readFileSync("dist/index.html", "utf8")
  .replace(/<title>[\s\S]*?<\/title>/g, "")
  .replace(/<meta\s+(?:name="description"|property="og:[^"]+")[^>]*>/g, "");
const safeJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
function makePage(path, product, category, items) {
  const meta = pageMetadata(path, product, category);
  const url = escapeHtml(base + (path === "/404" ? "/404.html" : path));
  const tags = `<title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}"/>
    <meta name="robots" content="${meta.robots}"/>
    <link rel="canonical" href="${url}"/>
    <meta property="og:type" content="website"/>
    <meta property="og:site_name" content="${SITE_NAME}"/>
    <meta property="og:locale" content="en_US"/>
    <meta property="og:title" content="${escapeHtml(meta.title)}"/>
    <meta property="og:description" content="${escapeHtml(meta.description)}"/>
    <meta property="og:url" content="${url}"/>
    <meta property="og:image" content="${base}/social.png"/>
    <meta property="og:image:alt" content="There Could Be An App — discover existing software"/>
    <meta name="twitter:card" content="summary_large_image"/>
    <meta name="twitter:title" content="${escapeHtml(meta.title)}"/>
    <meta name="twitter:description" content="${escapeHtml(meta.description)}"/>
    <meta name="twitter:image" content="${base}/social.png"/>
    <meta name="twitter:image:alt" content="There Could Be An App — discover existing software"/>
    <script type="application/ld+json" id="page-schema">${safeJson(pageStructuredData(base, path, meta, product, category, items))}</script>`;
  const rendered = renderPage(path, publishedCatalog);
  const embedded = product
    ? `<script type="application/json" id="catalog-product">${safeJson(product)}</script>`
    : `<script type="application/json" id="catalog-page">${rendered.data}</script>`;
  return template
    .replace("</head>", () => tags + "</head>")
    .replace(
      '<div id="root"></div>',
      () => `<div id="root">${rendered.body}</div>${embedded}`,
    );
}
function savePage(path, product, category, items) {
  const filename =
    path === "/"
      ? "dist/index.html"
      : path === "/404"
        ? "dist/404.html"
        : "dist" + path + ".html";
  mkdirSync(filename.slice(0, filename.lastIndexOf("/")), { recursive: true });
  writeFileSync(filename, makePage(path, product, category, items));
}

const snapshot = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const categories = JSON.parse(readFileSync("data/categories.json", "utf8"));
const seen = new Set();
const products = snapshot.products.map((p, i) => {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) ||
    p.slug.length > 100 ||
    seen.has(p.slug) ||
    !p.sources?.length ||
    !["identity", "capabilities"].includes(p.verification_scope)
  )
    throw new Error("Invalid or duplicate published identity/provenance");
  seen.add(p.slug);
  // Explicit public allowlist. Never spread a database row into a public file.
  return {
    id: i + 1,
    slug: p.slug,
    name: p.name,
    canonical_url: p.canonical_url,
    normalized_domain: new URL(p.canonical_url).hostname,
    short_description: p.short_description,
    audience: p.audience,
    search_aliases: p.search_aliases ?? "",
    category_slug: p.category_slug,
    category:
      categories.find((c) => c.slug === p.category_slug)?.name ??
      p.category_slug,
    first_seen_at: p.first_seen_at,
    announced_at: p.announced_at,
    last_verified_at: p.last_verified_at,
    verification_scope: p.verification_scope,
    identity_evidence_url: p.identity_evidence_url,
    identity_evidence_text: p.identity_evidence_text,
    capabilities: p.capabilities.map((c) => ({
      slug: c.slug,
      name: c.name,
      evidence_url: c.evidence_url,
      evidence_text: c.evidence_text,
      verified_at: c.verified_at,
    })),
    sources: p.sources.map((s) => ({
      source_name: s.source_name,
      source_url: s.source_url,
      discovered_at: s.discovered_at,
    })),
  };
});
if (products.length > 14000)
  throw new Error(
    "Static catalog exceeds the free asset allowance; revise bundling first.",
  );
const enrichedCategories = categories.map((c) => ({
  ...c,
  product_count: products.filter((p) => p.category_slug === c.slug).length,
}));
mkdirSync("dist/catalog/intelligence", { recursive: true });
const json = (path, value) =>
  writeFileSync("dist/" + path, JSON.stringify(value));
json("catalog/products.json", {
  exported_at: snapshot.exported_at,
  products,
  categories: enrichedCategories,
});
json("catalog/recent.json", {
  total: products.length,
  products: [...products]
    .sort(
      (a, b) => b.first_seen_at.localeCompare(a.first_seen_at) || b.id - a.id,
    )
    .slice(0, 24),
  offset: 0,
  limit: 24,
  catalog_updated_at: snapshot.exported_at,
});
json("catalog/search.json", {
  exported_at: snapshot.exported_at,
  index: buildSearchIndex(products),
});
json("catalog/stats.json", {
  products: products.length,
  catalog_updated_at: snapshot.exported_at,
});
json("catalog/categories.json", { categories: enrichedCategories });
const publishedCatalog = {
  exported_at: snapshot.exported_at,
  products,
  categories: enrichedCategories,
};
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
json("catalog/config.json", {
  turnstile_site_key: config.vars.TURNSTILE_SITE_KEY,
  submissions_enabled: config.vars.SUBMISSIONS_ENABLED === "true",
});
const buckets = Object.fromEntries(
  Array.from({ length: 256 }, (_, i) => [i.toString(16).padStart(2, "0"), {}]),
);
for (const p of products) {
  try {
    const value = JSON.parse(
      readFileSync("public/catalog-intelligence/" + p.slug + ".json", "utf8"),
    );
    const parsed = parseIntelligence(value, p.slug);
    if (
      parsed &&
      parsed.canonical_url.replace(/\/$/, "") ===
        p.canonical_url.replace(/\/$/, "")
    )
      buckets[intelligenceBucket(p.slug)][p.slug] = parsed;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
for (const [bucket, value] of Object.entries(buckets)) {
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024)
    throw new Error("Intelligence shard exceeds its browser limit");
  json("catalog/intelligence/" + bucket + ".json", value);
}
// Only published, validated preview records leave the build. Old/unpublished records vanish.
rmSync("dist/catalog-previews", { recursive: true, force: true });
mkdirSync("dist/catalog-previews", { recursive: true });
let previews = 0;
const previewSlugs = [];
for (const p of products) {
  try {
    const value = JSON.parse(
      readFileSync("public/catalog-previews/" + p.slug + ".json", "utf8"),
    );
    if (
      validPreview(value, p.slug) &&
      value.canonical_url.replace(/\/$/, "") ===
        p.canonical_url.replace(/\/$/, "")
    ) {
      json("catalog-previews/" + p.slug + ".json", value);
      previews++;
      previewSlugs.push(p.slug);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  savePage(
    "/apps/" + p.slug,
    p,
    enrichedCategories.find((c) => c.slug === p.category_slug),
  );
}
json("catalog/previews.json", { slugs: previewSlugs });
// Retired recovery/proxy assets and per-product intelligence copies have no public role.
for (const path of [
  "catalog-backup.json",
  "catalog-backup-sitemap.xml",
  "catalog-pages",
  "catalog-intelligence",
])
  rmSync("dist/" + path, { recursive: true, force: true });
const paths = ["/", "/about", "/submit", "/privacy", "/terms"];
for (const path of [...paths, "/search", "/admin", "/404"]) savePage(path);
// Every listing is reachable through real HTML links, without JavaScript or query parameters.
for (const category of [
  undefined,
  ...enrichedCategories.filter((c) => c.product_count > 0),
]) {
  const count = category?.product_count ?? products.length;
  for (let page = 1; page <= Math.ceil(count / 24); page++) {
    const path = catalogPath(category?.slug, page);
    const items = catalogResponse(
      publishedCatalog,
      `/products?category=${category?.slug ?? ""}&offset=${(page - 1) * 24}&sort=recent`,
    ).products;
    savePage(path, undefined, category, items);
    paths.push(path);
  }
}
paths.push(...products.map((p) => "/apps/" + p.slug));
writeFileSync(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeHtml(base + path)}</loc></url>`).join("")}</urlset>`,
);
function countFiles(path) {
  return readdirSync(path).reduce(
    (n, name) =>
      n +
      (statSync(path + "/" + name).isDirectory()
        ? countFiles(path + "/" + name)
        : 1),
    0,
  );
}
const assets = countFiles("dist");
if (assets > 19500)
  throw new Error("Static deployment exceeds reserved free asset budget");
json("catalog/build.json", {
  built_at: new Date().toISOString(),
  catalog_updated_at: snapshot.exported_at,
  products: products.length,
  previews,
  assets,
});
console.log(
  JSON.stringify({
    static_products: products.length,
    previews,
    assets,
    public_worker_calls: 0,
  }),
);

writeFileSync(
  "dist/robots.txt",
  readFileSync("public/robots.txt", "utf8").trim() +
    `\nSitemap: ${base}/sitemap.xml\n`,
);
