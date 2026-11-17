# Publisher metadata previews

Result cards use an optional publisher image and a shorter summary, with detailed match/evidence explanations behind a native disclosure. Official catalog names and verified capabilities remain authoritative. Open Graph/Twitter descriptions are labelled publisher text; they never create capability claims or affect search ranking.

## Autonomous collection

The public `Publisher metadata previews` GitHub workflow runs at minute 53 every six hours, independently of any local computer. It requires the existing `DISCOVERY_ENABLED=true` repository variable and only runs in this public repository on standard `ubuntu-latest` runners. Manual dispatch accepts a page limit from 1 to 100; the scheduled limit is 40. No new credentials or paid API are needed.

The collector starts from the published snapshot and a durable forward-only public identity index. `/api/preview-products?after=N` walks at most 500 primary-key IDs and returns at most 100 published identities per call; three calls maximum per run. Its primary-key queries avoid scanning the whole catalog. If the database is unavailable, the saved snapshot and index remain usable. No private review queue is read or published. The index retains entries between runs so a backlog cannot be skipped by a newest-only feed.

Each product page is fetched once. The existing safe fetcher validates public network destinations and redirects, respects robots/restrictions, and limits hosts, bytes and time. The collector reads standard metadata and tries at most two Open Graph, Twitter or icon image candidates. It never launches a browser or captures a screenshot. Normal discovery also preserves metadata from HTML it already fetched, within its private draft; preview publication remains restricted to already-published products.

## Explicit budgets

- Four collection workers; 40 product pages per scheduled run, 100 maximum manually; eight-minute collection deadline and 15-minute workflow timeout.
- Image downloads at most 1 MiB each; raster formats only, at most 12 million input pixels. Images are decoded and re-encoded as WebP, with metadata stripped. SVG is excluded.
- Each thumbnail is at most 480×300 and 24 KiB. Each JSON preview is at most 48 KiB including inline image data. An over-budget image is dropped while useful text survives.
- Public preview storage stops at 4,000 JSON files (including the public index) or 128 MiB. The index has its own 4 MiB limit. These are deliberate free-infrastructure ceilings, not unlimited growth promises.
- Successful records refresh after 30 days; failed fetches back off for seven days. Old usable metadata survives a failed refresh with its original collection date. Never-checked products receive priority over refreshes, with capability-verified products first.

The workflow commits only `public/catalog-previews/`. Its summary reports checked pages, image previews, text-only results, failures and stored bytes. A failed publisher fetch does not fail discovery or remove catalog entries. To inspect or manually trigger a batch, use [the preview workflow](https://github.com/hmapinheiro6/therecouldbeanapp/actions/workflows/previews.yml). Set the existing discovery variable to false to pause hosted collection.

## Delivery and free-tier behavior

Preview files included in a deployment are Cloudflare static Assets, requested only when a card approaches the viewport. A fresh bundled file needs no Worker invocation or D1 query. Images are embedded in the small JSON file, so visitors make no requests to product websites, image CDNs or external screenshot services.

For a missing or stale bundled file, `/api/previews/:slug` reads only a fixed public GitHub path through Cloudflare's edge cache. New hosted previews therefore become available without deploying the app again. The route has bounded reads, a 2.5-second upstream timeout, a bundled fallback, and a one-hour negative cache. Successful responses are cached at the edge for a day and in the browser for six hours. This optional dynamic route still consumes Worker requests under the existing plan; caching reduces upstream fetches, not the plan's request accounting. Card rendering performs **zero D1 reads or writes**.

The client retains at most 128 preview promises per session. Missing metadata, unavailable GitHub, restricted sites, oversized files and broken images all leave the name/domain fallback and normal findings link usable. Preview loading never blocks search. No R2, KV, image-resizing service or paid screenshot provider is introduced. Public GitHub standard-runner pricing and existing Cloudflare plan limits still apply.

## Verification

Python tests cover metadata precedence/escaping, URL safety, thumbnail budgets, failed refresh preservation and bounded backlog collection. Worker tests cover fixed-path validation, size limits, caching, fallback and zero database access. Desktop/mobile browser tests cover real image rendering, lazy requests, static-first delivery, broken-image fallback, evidence disclosure and publisher/evidence separation.

## First hosted collection, 16 November 2026

[GitHub-hosted run 43933965163](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43933965163) checked 100 public products: 74 image previews, 18 metadata-only records, eight unavailable pages, and zero D1 writes. The runner committed its results as `bb397af`. The 100 records occupy 568,353 bytes in total; the largest is 29,212 bytes. All passed the application's preview validator before deployment. The eight failures retain ordinary card fallbacks and wait for the configured retry window. This is the first bounded batch, not completion of the whole-catalog backfill.
