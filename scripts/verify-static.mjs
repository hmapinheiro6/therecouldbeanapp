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
const base = new URL(config.vars.SITE_URL).origin;
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (new Set(urls).size !== urls.length)
  throw new Error("Duplicate sitemap URL");
const pagePaths = new Set(
  urls.map((url) => {
    const parsed = new URL(url);
    if (parsed.origin !== base || parsed.search || parsed.hash)
      throw new Error("Sitemap must contain only canonical site URLs");
    return parsed.pathname;
  }),
);
const links = new Map();
for (const path of pagePaths) {
  const html = readFileSync(
    path === "/" ? "dist/index.html" : "dist" + path + ".html",
    "utf8",
  );
  if (!html.includes("<h1") || html.includes('<div id="root"></div>'))
    throw new Error("Empty HTML shell: " + path);
  const head = html.slice(0, html.indexOf("</head>"));
  for (const pattern of [
    /rel="canonical"/g,
    /name="description"/g,
    /property="og:url"/g,
    /name="twitter:card"/g,
  ])
    if ((head.match(pattern) ?? []).length !== 1)
      throw new Error("Missing or duplicate metadata: " + path);
  if (
    !html.includes(`rel="canonical" href="${base + path}"`) ||
    !html.includes(`property="og:url" content="${base + path}"`)
  )
    throw new Error("Wrong canonical or social URL: " + path);
  if (/name="robots" content="noindex/.test(html))
    throw new Error("Nonindexable page in sitemap: " + path);
  const structured = JSON.parse(
    html.match(
      /<script type="application\/ld\+json" id="page-schema">([\s\S]*?)<\/script>/,
    )?.[1] ?? "null",
  );
  if (!structured?.["@graph"]?.some((v) => v.url === base + path))
    throw new Error("Missing page structured data: " + path);
  const body = html.slice(html.indexOf('<div id="root">'));
  const outgoing = [...body.matchAll(/href="([^"#]+)"/g)]
    .map((m) => new URL(m[1].replace(/&amp;/g, "&"), base))
    .filter((url) => url.origin === base && !url.search)
    .map((url) => url.pathname);
  for (const target of outgoing)
    if (
      /^\/(apps|categories|explore)(\/|$)/.test(target) &&
      !pagePaths.has(target)
    )
      throw new Error("Broken catalog link: " + path + " → " + target);
  links.set(
    path,
    outgoing.filter((target) => pagePaths.has(target)),
  );
}
const reached = new Set(),
  queue = ["/"];
for (let i = 0; i < queue.length; i++) {
  const path = queue[i];
  if (reached.has(path)) continue;
  reached.add(path);
  queue.push(
    ...(links.get(path) ?? []).filter((target) => !reached.has(target)),
  );
}
if (reached.size !== pagePaths.size)
  throw new Error("Sitemap pages are orphaned from homepage HTML");
for (const path of ["search", "admin", "404"]) {
  const html = readFileSync(`dist/${path}.html`, "utf8");
  if (
    !html.includes('name="robots" content="noindex,nofollow"') ||
    pagePaths.has("/" + path)
  )
    throw new Error("Private, search or error page is indexable");
}
const robots = readFileSync("dist/robots.txt", "utf8");
if (
  robots.includes("Disallow: /search") ||
  !robots.includes(`Sitemap: ${base}/sitemap.xml`)
)
  throw new Error(
    "Robots must advertise sitemap and allow reading search noindex",
  );
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
  for (const source of product.sources ?? [])
    if (!html.includes(source.source_url.replace(/&/g, "&amp;")))
      throw new Error("Product HTML is missing source attribution");
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
    crawlable_pages: reached.size,
    worker_routes: expected,
  }),
);
