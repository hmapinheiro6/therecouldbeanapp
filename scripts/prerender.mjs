// Static metadata for non-product pages. Product metadata is rendered against live D1.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "jsonc-parser";
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
  about: [
    "About — There Could Be An App",
    "A source-backed software search engine with a raised eyebrow.",
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
    "Browse real software with capabilities backed by official evidence.",
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
  if (path === "search")
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
