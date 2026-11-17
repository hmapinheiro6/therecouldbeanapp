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
import { escapeHtml, productSummary } from "../worker/seo.ts";
const base = new URL(
  parse(readFileSync("wrangler.jsonc", "utf8")).vars.SITE_URL,
).origin;
const html = readFileSync("dist/index.html", "utf8").replace(
  'content="/social.png"',
  'content="' + base + '/social.png"',
);
writeFileSync(
  "dist/index.html",
  html.replace(
    "</head>",
    '<link rel="canonical" href="' + base + '/"/></head>',
  ),
);
const pages = {
  admin: ["Catalog review — There Could Be An App", "Private catalog review."],
  about: [
    "About — There Could Be An App",
    "Find existing apps and SaaS products, with evidence from their official websites.",
  ],
  privacy: [
    "Privacy — There Could Be An App",
    "What we process, what we keep, and how spam protection works.",
  ],
  terms: [
    "Terms — There Could Be An App",
    "Terms for researching software and submitting a product.",
  ],
  submit: [
    "Submit your app — There Could Be An App",
    "Submit your software for independent verification and inclusion in the catalog.",
  ],
  explore: [
    "Explore the catalog — There Could Be An App",
    "Browse software with checked official websites and clearly labelled feature evidence.",
  ],
  search: [
    "The reality check — There Could Be An App",
    "Find relevant software for your app idea.",
  ],
};
for (const [path, [title, description]] of Object.entries(pages)) {
  let page = html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`);
  page = page
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`)
    .replace(
      /(<meta property="og:description" content=")[^"]*/,
      `$1${description}`,
    );
  page = page.replace(
    "</head>",
    '<link rel="canonical" href="' + base + "/" + path + '"/></head>',
  );
  if (path === "search" || path === "admin")
    page = page.replace(
      "</head>",
      '<meta name="robots" content="noindex,nofollow"/></head>',
    );
  mkdirSync(`dist/${path}`, { recursive: true });
  writeFileSync(`dist/${path}/index.html`, page);
}

writeFileSync(
  "dist/404.html",
  html.replace(
    "</head>",
    '<meta name="robots" content="noindex,nofollow"/></head>',
  ),
);

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
  const canonical = base + "/apps/" + p.slug;
  const description = escapeHtml(p.short_description),
    title = escapeHtml(p.name + " — There Could Be An App");
  const data = JSON.stringify(p).replace(/</g, "\\u003c");
  const structured = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: p.name,
    url: p.canonical_url,
    description: p.short_description,
    applicationCategory: p.category,
  }).replace(/</g, "\\u003c");
  const page = html
    .replace(/<title>.*?<\/title>/, () => `<title>${title}</title>`)
    .replace(
      /(<meta name="description" content=")[^"]*/,
      () => `<meta name="description" content="${description}`,
    )
    .replace(
      /(<meta property="og:title" content=")[^"]*/,
      () => `<meta property="og:title" content="${title}`,
    )
    .replace(
      /(<meta property="og:description" content=")[^"]*/,
      () => `<meta property="og:description" content="${description}`,
    )
    .replace(
      '<div id="root"></div>',
      () =>
        `<div id="root">${productSummary(p)}</div><script type="application/json" id="catalog-product">${data}</script><script type="application/ld+json">${structured}</script>`,
    )
    .replace(
      "</head>",
      () =>
        `<link rel="canonical" href="${escapeHtml(canonical)}"/><meta property="og:url" content="${escapeHtml(canonical)}"/></head>`,
    );
  mkdirSync("dist/apps", { recursive: true });
  writeFileSync("dist/apps/" + p.slug + ".html", page);
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
const paths = [
  "",
  "/about",
  "/explore",
  "/submit",
  "/privacy",
  "/terms",
  ...products.map((p) => "/apps/" + p.slug),
];
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
  `User-agent: *\nDisallow: /api/\nDisallow: /search\nSitemap: ${base}/sitemap.xml\n`,
);
