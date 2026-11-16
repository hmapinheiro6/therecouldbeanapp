# D1 quota incident and recovery

16 November 2026. The sign-in screenshot showed the generic 503 message. A direct production request reproduced it; a Wrangler query returned: “Your account has exceeded D1's free tier daily row read limit.” This is an account-wide provider limit, not evidence of an incorrect admin key or lost products. Cloudflare documents five million daily reads on Free and a reset at 00:00 UTC: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Root cause and corrective work

The export used a correlated product-source subquery without a product-ID index. At 2,785 products, SQLite's query plan showed `SCAN s` once per product. This was missed during the expansion release. An isolated restore of the actual public data reproduced about 31,247,000 SQLite VM instructions for a representative provenance export; with the new source index it took about 70,000. These are local execution measurements, not provider billing-row totals. Account-wide consumption may include other queries and applications.

- Replaced the correlated export with four linear reads and in-memory grouping. Export now reports actual provider rows read. It still uses an explicit public-field allow-list.
- Added migration **0010_read_budget_indexes.sql** for source hydration, canonical aliases, ordered public pagination, and candidate URL lookup.
- Public category/stats aggregates now use a five-minute edge cache; queries, submissions, sessions, and review responses are never stored in that cache.
- Reduced scheduled directory checks to 100 candidates per run. Existing cloud discovery/backfill jobs now call a signed, fixed-SQL maintenance endpoint before source work. It installs and records migration 0010 idempotently after D1 becomes available. No new Cloudflare credential is distributed to GitHub.
- The ingestion client stops immediately on the daily-limit error rather than retrying it in seconds. Checkpoints and private queues remain in D1.

## Available during the incident

The deployed build contains the sanitized **2,785-product public snapshot** as a static asset, with public product HTML and a sitemap. On the specific daily-quota error, browsing, category filters, product details, counts, and search recover from that copy. A visible notice names its export time and warns that recent changes may be missing. Search runs in the visitor's browser using bounded lexical candidate selection and the existing evidence-aware ranker; it does not claim identical FTS5 ordering. No user idea is sent to a third-party service.

This is a saved public catalog, not a live replica. Edits or unpublishing after that export can remain visible in recovery mode until the snapshot is refreshed; the notice states this. Deployment rebuilds the static recovery pages from the checked-in sanitized snapshot. Refresh it with the corrected export after database recovery and redeploy. No pending products, founder emails, review drafts, sessions, or secrets are in these public assets.

Admin authentication and publishing continue to require the real database. They fail closed with `database_daily_limit`, a `reset_at` value, and an accurate `Retry-After`. The login message explicitly says the submitted key was not checked. The expected reset is **17 November 2026 at 00:00 UTC**, also midnight Lisbon. An unavailable queue shows unknown counts instead of zero. There is no authentication bypass, paid upgrade, replacement database, or claim that approvals worked while D1 was blocked.

## Verification and outstanding provider block

**128 automated cases:** 48 TypeScript/search/API/database, 64 Python ingestion/security, and 16 desktop/mobile browser cases. New coverage exercises quota errors with no session cookie, tracked maintenance idempotence, snapshot search evidence, category/pagination reads, live-to-snapshot browser recovery, and no tight-loop quota retries. Lint, strict TypeScript, build, and static privacy checks pass.

Production verified the precise login quota error, absence of a session cookie, 2,785 records in the public backup, and HTTP 200 source-backed product HTML in snapshot mode. A remote migration attempt remains blocked by the same provider quota; migration 0010 is prepared and will be applied by the next successful signed scheduled maintenance call. Normal sign-in cannot be reverified until D1 resets. This remaining block is explicit; the incident is mitigated, not represented as fully recovered.
