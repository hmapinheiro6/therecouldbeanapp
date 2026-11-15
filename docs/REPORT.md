# Engineering report

Status as of 15 November 2026: the complete local application is implemented and tested. Production provisioning is in progress under the authorized Cloudflare Workers Free account. Do not interpret this interim report as a successful deployment.

## Implemented

- Responsive editorial React application: homepage, plain-language search, classified results, refinement/sharing, category exploration, source-backed product details, submission form, about/privacy/terms, branded 404.
- Hono/Zod API connected to actual D1 FTS5, canonical relational schema, publication/capability synchronization triggers, materialized bounded candidate retrieval, deterministic taxonomy and explanations.
- 45 real verified products, 37 categories, 38 capability definitions, and 61 evidenced product-capability claims. Official checks are recorded in `data/seeds/verification-report.json`.
- Turnstile server validation with hostname/action checks, token replay protection, hashed daily submission limits, real pending persistence, duplicate detection, signed private moderation/ingestion APIs.
- HN/GitHub discovery, RSS/Atom/JSON adapters (questionable feeds disabled), pinned-DNS HTTPS verification, robots/redirect/size/time limits, deterministic publication gates, review/retry queue, persisted checkpoints, daily public-runner Actions workflows.
- Sanitized snapshots, canonical SQL recovery and FTS rebuild, security headers, server-rendered product facts, crawl policy, sitemap and social assets.

Code: `src/`, `worker/`, `ingestion/`, `migrations/`, `.github/workflows/`. Operational procedures are documented alongside this report.

## Verification so far

32 TypeScript/API/search/database tests, 30 Python pipeline/security tests, and 12 desktop/mobile Playwright cases pass. Strict TypeScript, ESLint, and production Vite build pass. Dependency audit reported zero known vulnerabilities at installation time.

The 60-case local engineering benchmark has 54 cases with known relevant catalog products: precision over returned top-five slots 100%, recall@10 99.15%, MRR 1.0, and zero unsupported strong classifications under its explicit checks. These are single-author, limited-vocabulary measurements; not a blind external study or proof of broad catalog coverage. Local Node/SQLite timings and synthetic 1,000/10,000-record capacity checks are in `benchmark-results.json`. Production Worker CPU and D1 usage still need measurement.

## Observed ingestion

An actual discovery dry run processed seven public HN/GitHub candidates: zero passed publication gates and seven entered review. `discovery-dry-run.json` records the run. A separate signed import of all 45 independently fetched seed records updated real **local** persisted D1, with a successful run record; see `local-ingestion-proof.json`. Neither event is claimed as production discovery.

## Infrastructure and external state

The public repository was created at https://github.com/hmapinheiro6/therecouldbeanapp. Wrangler authorization succeeded. The Cloudflare dashboard explicitly showed **Free / $0 / Current plan** before provisioning. No plan upgrade, paid AI/search, domain registration, or email service was requested.

The domain's ownership is unconfirmed. Production Turnstile setup, GitHub secret/variable setup, live discovery, production smoke checks, and operator privacy details are being completed where authorization permits. The policy text deliberately identifies the preview state; public submissions remain disabled until real operator details exist.

## Known limitations

The seed catalog is useful but small; no 1,000-product count is fabricated. Automated name/capability verification is conservative and leaves many real products for review. Complex negation, unknown audiences, and unsupported niche requirements need more taxonomy work. No independent blind human evaluator has assessed search quality. Source fetches can be blocked and schedules can pause after 60 days of repository inactivity. These are operational limits, not reasons to invent coverage or silently enable paid services.
