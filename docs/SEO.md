# Search and AI discovery

Audit date: 27 November 2026. The live origin is the `SITE_URL` in `wrangler.jsonc`: https://therecouldbeanapp.henriquepinheiro.workers.dev.

## Findings and implementation

The production homepage, Explore and information pages returned empty React roots before JavaScript. Product HTML had evidence excerpts, but omitted source attribution. Explore relied on query parameters and browser-loaded pagination. Client navigation left previous descriptions, social tags and structured data behind. Missing routes could become indexable after JavaScript ran. Search was disallowed in robots.txt, which prevented compliant crawlers from reading its noindex directive.

`scripts/prerender.mjs` now renders the actual React pages at build time through `scripts/render-page.tsx`. Rendering reads only the public field allowlist and never queries D1. Safely embedded public responses let browser initialization display the catalog immediately. Configuration, submissions and private operations retain their existing boundaries.

Product HTML includes official website links, verification scope, source excerpts, attribution and dates. The homepage explains software discovery and verification limits. Static routes at `/categories/<slug>`, `/explore/page/<n>` and `/categories/<slug>/page/<n>` provide ordinary links to every listing. Query-based sorting/filtering still works; canonicals omit query variants. Published pages appear in the sitemap. Unknown category and pagination URLs return the static error page with HTTP 404.

`src/lib/seo.ts` supplies consistent titles, descriptions, canonicals, Open Graph and Twitter metadata to the build and client navigation. WebSite, WebPage/CollectionPage/AboutPage, BreadcrumbList and SoftwareApplication structured data describe visible content. Feature lists use documented capabilities. Prices, ratings, reviews and test results are not invented. SoftwareApplication markup alone does not establish eligibility for Google's software rich results.

Search, administrative and error pages have noindex metadata. Search has an HTTP noindex header and is crawlable so bots can read it. The wildcard robots group permits public HTML for search engines and AI discovery crawlers while excluding `/api/` and `/admin`. The sitemap origin comes from `SITE_URL`; a domain change requires updating that setting and redeploying.

The change adds no runtime rendering, D1 reads, paid service or external script to public browsing. The snapshot contains 6,001 products, 6,530 indexable HTML pages and 6,953 static assets, below the existing 19,500-asset guard.

## Verification

Run `npm run build && npm run verify:static`. The verifier checks metadata, canonicals, parseable structured data, product attribution, sitemap exclusions, the static request boundary and traversal from the homepage through HTML links. Orphaned listings and broken catalog links fail the build checks. CI and the static publication workflow run this verification.

Browser regressions cover navigation without JavaScript, official feature evidence, HTTP 404 responses, search noindex headers and metadata changes across client navigation. The complete desktop/mobile suite passed 42 checks; the TypeScript/search/API suite passed 157 checks. A historical campaign test needed its own dated usage fixture: the ordinary fixture now seeds 27 November rather than the campaign's 17 November.

## Publication and measurement

These changes are verified locally. The production check still returned the 17 November release and its empty homepage root. Credential preflight failed because `CLOUDFLARE_API_TOKEN` is absent from this session; production deployment was not attempted. Publish through the authoritative export, removal and locking workflow in `.github/workflows/static-publish.yml`, documented in `STATIC-OPERATIONS.md`. Avoid deploying an old snapshot over newer moderation decisions. Rebuild after browser tests: their local server disables submissions in the built configuration.

After publication, verify ownership in Google Search Console and Bing Webmaster Tools, submit `/sitemap.xml`, inspect representative homepage/category/product URLs, and monitor indexing, crawl errors, organic queries and AI search referrals. Check Cloudflare firewall settings against providers' verified crawler IP ranges; an ordinary request or spoofed user agent does not prove real crawler access. Field Core Web Vitals, index coverage and recommendation visibility require production observations and were not established by local tests. Domain ownership, webmaster account access and production firewall changes are outside this code change.

Google's [AI feature guidance](https://developers.google.com/search/docs/appearance/ai-features) emphasizes crawlable, helpful content, internal links and structured data matching visible text. No special AI file is required. OpenAI documents [OAI-SearchBot separately from training crawlers](https://developers.openai.com/api/docs/bots). Technical eligibility cannot guarantee crawling, indexing, citations or recommendations. Improving source coverage, refreshing observations and earning independent mentions remain ongoing editorial work.
