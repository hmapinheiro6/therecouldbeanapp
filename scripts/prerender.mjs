// Static metadata for non-product pages. Product metadata is rendered against live D1.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

// Static public recovery copy. Never include pending/private records or secrets.
const snapshot = JSON.parse(
  readFileSync("data/seeds/published-snapshot.json", "utf8"),
);
const categories = JSON.parse(readFileSync("data/categories.json", "utf8"));
const products = snapshot.products.map((p, index) => ({
  id: index + 1,
  slug: p.slug,
  name: p.name,
  canonical_url: p.canonical_url,
  normalized_domain: new URL(p.canonical_url).hostname,
  short_description: p.short_description,
  audience: p.audience,
  search_aliases: p.search_aliases ?? "",
  category_slug: p.category_slug,
  category:
    categories.find((c) => c.slug === p.category_slug)?.name ?? p.category_slug,
  first_seen_at: p.first_seen_at,
  announced_at: p.announced_at,
  last_verified_at: p.last_verified_at,
  verification_scope: p.verification_scope,
  identity_evidence_url: p.identity_evidence_url,
  identity_evidence_text: p.identity_evidence_text,
  capabilities: p.capabilities,
  sources: p.sources.map((s) => ({
    source_name: s.source_name,
    source_url: s.source_url,
    discovered_at: s.discovered_at,
  })),
}));
writeFileSync(
  "dist/catalog-backup.json",
  JSON.stringify({
    exported_at: snapshot.exported_at,
    products,
    categories: categories.map((c) => ({
      ...c,
      product_count: products.filter((p) => p.category_slug === c.slug).length,
    })),
  }),
);
mkdirSync("dist/catalog-pages", { recursive: true });
// Keep the complete JSON recovery catalog, with bounded optional HTML copies.
// 12000 intelligence + 4000 preview + 2000 HTML assets fit the Free file limit.
const recoveryPages = [...products]
  .sort(
    (a, b) =>
      Number(b.verification_scope === "capabilities") -
        Number(a.verification_scope === "capabilities") ||
      b.first_seen_at.localeCompare(a.first_seen_at),
  )
  .slice(0, 2000);
for (const p of recoveryPages) {
  if (!/^[a-z0-9-]{1,100}$/.test(p.slug))
    throw new Error("Invalid public snapshot slug.");
  const canonical = base + "/apps/" + p.slug;
  const saved = html
    .replace(
      /<title>.*?<\/title>/,
      `<title>${escapeHtml(p.name)} — There Could Be An App</title>`,
    )
    .replace(
      /(<meta name="description" content=")[^"]*/,
      `$1${escapeHtml(p.short_description)}`,
    )
    .replace(
      '<div id="root"></div>',
      `<div id="root"><p class="notice">Saved public catalog from ${escapeHtml(snapshot.exported_at)}. Recent changes may be missing.</p>${productSummary(p)}</div>`,
    )
    .replace(
      "</head>",
      `<link rel="canonical" href="${escapeHtml(canonical)}"/></head>`,
    );
  writeFileSync("dist/catalog-pages/" + p.slug + ".html", saved);
}
writeFileSync(
  "dist/catalog-backup-sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", "/about", "/submit", ...products.map((p) => "/apps/" + p.slug)].map((path) => `<url><loc>${base}${path}</loc></url>`).join("")}</urlset>`,
);
