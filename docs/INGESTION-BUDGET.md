# Import and export safety budgets

All work below can be verified locally while D1 is unavailable. None of it raises the account plan or bypasses the daily provider block.

## Automatic imports

Signed ingestion reserves a shared **20,000 estimated work units per UTC day**, persisted in `ingestion_daily_budget`. A conditional SQLite UPSERT arbitrates concurrent jobs. Each product reserves 80 units plus eight per capability, each queued candidate twelve, each checkpoint four, and each run update four. Reservations precede mutations and remain consumed after an interrupted batch. They stop imports with `ingestion_daily_budget`, HTTP 429, a UTC reset time and `Retry-After`. The client does not retry that response in seconds. Both scheduled ingestion workflows use the same concurrency group.

These are conservative project estimates, **not Cloudflare billing counters**. They do not guarantee that an account-wide read/write quota cannot be reached: visitors, admin, authentication, retries, maintenance, and other databases also consume it. The provider daily-limit handling and public saved catalog remain necessary. The allowance deliberately leaves room for those uses; increasing it requires reviewing actual provider usage.

Migration **0011_ingestion_budget.sql** creates the reservation table. The signed maintenance step applies and tracks it idempotently alongside pending migration 0010 after the provider reset. Both migrations remain unapplied in production during the current block. No production D1 calls were made for this work.

## Saved public export

`node scripts/export-published.mjs` is an **offline plan**. After D1 recovers, `node scripts/export-published.mjs --remote --max-rows 100000` performs four public-field-only linear queries. It rejects incomplete results, absent provider read accounting, missing provenance, duplicate URLs, an empty export, a decline greater than 10%, or reported reads above the declared limit. A local exclusive lock prevents overlapping exports in one checkout. A validated temporary file replaces the snapshot atomically; failures preserve the previous copy. A lock left by an ungraceful process exit must be investigated before removal.

The read limit is checked **after the provider executes the queries**. It protects snapshot promotion, not a billing cap. A deliberate large catalog removal may trip the shrink guard; review it before adjusting the guard. Refreshing the file alone does not deploy new public recovery assets; build and deploy after reviewing the diff.

## Query-work regression check

`python3 scripts/benchmark-query-cost.py --output docs/quota-query-cost.json` restores all 2,785 exported records into an isolated local SQLite database, applies migrations, checks the actual export plans, and counts approximate SQLite VM instructions. The four queries used about **130,000 instructions**, below a catalog-size-scaled threshold of **557,000**. This is local execution work, **not provider row-read usage**. The check runs in CI to catch a return to correlated per-product scans. API tests cover concurrent reservation limits, UTC rollover, refusal without catalog/import mutations, tracked migration replay, and immediate client stop.
