# Final engineering report

Delivered 15 November 2026. [Live application](https://therecouldbeanapp.henriquepinheiro.workers.dev) · [Public source](https://github.com/hmapinheiro6/therecouldbeanapp).

## A. Implemented features

The responsive React application includes the editorial homepage, plain-language search, refinement and URL sharing, strong/partial/related result labels, evidence-based explanations, category exploration, product details, a protected submission form, about/privacy/terms pages, and a branded 404. Loading, empty, validation, and provider-error states use the actual API. See `src/pages/`, `src/components/`, and `src/lib/api.ts`.

`worker/index.ts` exposes search, products, categories, stats, health, submission, and authenticated ingestion/moderation routes. Product URLs return escaped source-backed HTML and structured data before React loads. Static route metadata, canonical URLs, social imagery, robots rules, and sitemap are implemented in `scripts/prerender.mjs`, `public/`, and the Worker. Arbitrary search pages are noindex.

## B. Architecture

React 19 + strict TypeScript + Vite + Tailwind builds static assets hosted with a Hono Cloudflare Worker. D1 stores canonical relational records and a derived FTS5 index. Search retrieves at most 80 candidates using a materialized BM25 query, then hydrates verified capabilities in one indexed query. No website fetching or model inference happens during visitor searches.

Public standard GitHub Actions runners execute bounded Python discovery and verification, then send HMAC-signed batches to the deployed API. D1 persists checkpoints, runs, review queues, submissions, evidence, replay nonces, and hashed rate identifiers. No personal computer is needed for scheduled operation. See `docs/ARCHITECTURE.md`, `worker/catalog.ts`, `worker/security.ts`, and `ingestion/`.

## C. Search quality

`data/benchmark.json` contains 60 hand-authored queries, including 54 with known relevant seed products and six coverage gaps. Judgments are a single-author engineering evaluation, with additional official feature-source checks; no blind independent evaluation is claimed. The local benchmark uses the 45 curated seeds, while production has one additional discovered product.

| Measurement | Result | Interpretation |
| --- | ---: | --- |
| Strict Precision@5 | **52.59%** | Five fixed slots per supported case; **below the requested 80% target** |
| Precision among returned top-five results | 100% | Different denominator, `min(5, returned)`; not standard Precision@5 |
| Recall@10 | 99.15% | Above 85% target, within known catalog judgments |
| MRR | 1.0 | Supported queries only |
| Unsupported strong classifications | 0 | Within the benchmark's explicit checks |
| Mean top-result capability coverage | 100% | Recognized supported capabilities only |
| Production network p50 / p95 | 177.94 / 331.20ms | 60 sequential queries, zero HTTP errors |
| Production CPU p50 / p99 | 3.136 / 12.502ms | 67 observed requests during that window; p99 exceeds 10ms Free allowance |

The strict precision shortfall reflects sparse coverage: many queries have fewer than five relevant catalog records. Returning unrelated products to fill five slots would not improve the service. The taxonomy handles synonyms, common misspellings, exclusions, and explicit capabilities; unknown meaningful requirements conservatively prevent strong labels. Complex negation and unfamiliar phrasing remain limitations.

Measured local synthetic lexical loads of 1,000 and 10,000 records use rolled-back copies, not real published products. They exercise bounded retrieval and are not evidence of semantic coverage or production CPU. Full outputs: `docs/benchmark-results.json`, `production-search-benchmark.json`, `production-search-cpu.json`, and `production-d1-measurement.json`. Details and methodology: `docs/SEARCH.md`.

## D. Database

Production D1 contains **46 published products, 37 category definitions, 39 capability definitions, and 62 verified product-capability claims**. Not every category/capability has product coverage. The initial official-site verification checked 53 candidates and retained 45 publishable products; eight inaccessible or insufficiently verified candidates are recorded separately. Cloud discovery added one product.

Every published record has a real official URL, useful description, category, verification date, and source provenance. No unsupported launch dates, customer counts, pricing, or reviews were invented. First-seen dates are distinct from source-story dates. Normalized tables, constraints, indexes, FTS lifecycle triggers, publication blocks, and four versioned migrations are in `migrations/`. A sanitized actual production export is in `data/seeds/published-snapshot.json`; canonical SQL restoration and FTS reconstruction are documented in `docs/OPERATIONS.md`.

## E. Ingestion

Enabled discovery sources are the official Hacker News Firebase API and GitHub REST API. RSS/Atom/JSON adapters exist; ScrollLaunch and Product Hunt remain disabled pending endpoint/permission clearance. Verification respects robots and access restrictions, pins validated public DNS addresses with TLS hostname checks, revalidates redirects, limits pages/bytes/time/retries, executes no website JavaScript, and requires an official identity plus explicit capability evidence. Original controlled descriptions avoid copying directory prose.

[Successful cloud run 43759620161](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43759620161) completed at **20:43:39 UTC on 15 November 2026**: **15 candidates processed, one accepted, 14 pending review, zero rejected**, successful D1 updates and checkpoints. D1 run ID: `2e7b012d-632d-4b7f-8054-aec08ef687f4`. Pizza was automatically published, then its evidence was reviewed and precisely classified as app connections through MCP. Its public record is included in the production snapshot.

Earlier cloud attempts exposed client identification and IPv6 connectivity failures; both were fixed and the failure records retained. The daily workflow is enabled at **04:17 UTC**, with a 40-candidate batch cap. Retries, persisted checkpoints, failure recording, canonical/source deduplication, and moderation are implemented in `ingestion/` and `.github/workflows/`. GitHub schedules are best effort and can disable after 60 days of repository inactivity.

## F. Submissions

Public submissions are enabled with a real Free managed Turnstile widget restricted to the production hostname. The backend validates the secret, hostname, and `submit` action, rejects token replay, enforces hashed daily IP limits and strict request sizes, stores pending submissions in D1, and detects known product duplicates. No production bypass/test key exists.

A real production browser submission for Otter passed Turnstile and reached the duplicate response, **“Beat you to it. See Otter”**. This confirms real browser-to-Siteverify-to-catalog behavior; it did not create a new listing. Automated local API tests separately confirm valid pending persistence, rejection, replay, rate limits, and signed moderation. A fresh nonduplicate production submission has not been claimed as tested.

The private CLI and manual moderation workflow support approve/reject/retry/remove. Approval queues independent verification rather than immediate publication. Contacts remain private, are removed after 30 days by scheduled cleanup, and never enter public snapshots. The supplied public support/privacy contact is **support@therecouldbeanapp.com**; mailbox delivery was not tested. See `src/pages/Submit.tsx`, `src/components/Turnstile.tsx`, `worker/security.ts`, and `ingestion/admin.py`.

## G. Tests

**81 automated checks pass:** 35 TypeScript/search/API/database tests, 34 Python ingestion/security tests, and 12 desktop/mobile Playwright cases. The API suite uses actual workerd/D1; browser tests use the real local frontend and API. Fresh/repeated/populated migrations, FTS lifecycle/rebuild, malicious inputs, signed replay protection, invalid/replayed Turnstile, pending persistence, and safe crawling have coverage. Turnstile substitution is restricted to isolated API tests.

ESLint, strict TypeScript, production build, dependency audit (zero known vulnerabilities at verification), and the 60-case benchmark complete successfully. The benchmark's unmet quality target is reported above and is not represented as a passing threshold assertion. Hosted CI is configured for pushes/PRs; [the deployed baseline CI](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43759620386) passed. Final-source CI status is available from the repository's Actions tab.

Production smoke tests covered health/stats/config/search/product APIs, source-backed product HTML, sitemap, missing-page 404, and invalid Turnstile rejection. Records: `docs/production-smoke.json`. Actual production desktop/mobile captures are `docs/homepage-desktop.png` and `docs/homepage-mobile.png`.

## H. Infrastructure and costs

The Cloudflare account dashboard explicitly showed **Free / $0 / Current plan**. This project has its own Worker, D1 database, Turnstile widget, and application secrets; no unrelated application database was reused. Public standard Actions runners are used. No paid AI/search, vector database, scraping, email delivery, analytics subscription, paid assets, domain purchase, or plan upgrade was added.

The expected infrastructure cost is €0 within current free quotas, excluding domain registration/renewal. Limits are account-wide. Workers Free allows 100,000 dynamic requests/day and 10ms CPU/request; D1 allows five million rows read/day and 100,000 written/day. Static assets bypass Worker execution. Batches, request sizes, fetch budgets, retries, and candidate hydration are bounded.

Production CPU p99 exceeded the 10ms allowance in measured samples, despite zero observed errors; sustained Free CPU compliance remains a real risk. A representative production search read **46 rows**, wrote zero, and used **1.5934ms** SQL time; this is not a worst-case bound. Provider-level quota/CPU failures can happen outside application error handling. The frontend handles non-JSON platform errors gracefully. Nothing automatically upgrades the plan. See `docs/COSTS.md` and production measurement files.

No advertising trackers or analytics scripts are installed. Provider aggregate invocation metrics and ingestion/run counters support operations without retaining raw idea text. Fine-grained visitor/search/click analytics are intentionally absent.

## I. Deployment

Live: **https://therecouldbeanapp.henriquepinheiro.workers.dev**.

Source: **https://github.com/hmapinheiro6/therecouldbeanapp**.

Worker `therecouldbeanapp` uses isolated D1 `therecouldbeanapp-catalog` (`2a24c33c-ee1f-4dba-b601-39f00232e3ea`). All four migrations are applied. Real Turnstile and separate signing/rate secrets are in provider storage. GitHub holds the encrypted application signing secret and configured API/discovery variables. The latest verified deployment version is `d6f44e22-602c-4f42-ad21-ac3a629d7abd`, deployed at 20:56 UTC. Deployment does not depend on the local development server.

The custom domain is **not connected** because ownership/DNS authorization was not established. No purchase occurred. The workers.dev URL is fully usable. Reproduction and custom-domain steps are in `docs/DEPLOYMENT.md`.

## J. Remaining issues and limits

- Grow the real catalog toward 1,000 verified products and improve the unmet strict Precision@5 target. No synthetic records are presented as coverage.
- CPU tail measurements exceed the native Free allowance; monitor real errors and optimize further before substantial traffic.
- Independent blind search evaluation, broader vocabulary, and complex negation need further work.
- Verification is based on public feature claims, not hands-on product certification; blocked/unclear candidates need review.
- Scheduled discovery/retention depend on GitHub schedule health and account-wide quotas. Operational maintenance is required.
- Custom domain/DNS and support-mailbox delivery remain unverified. No email delivery service is configured.
