# Database and hosting review, 17 November 2026

This is a migration assessment, not a completed migration. No Supabase/Vercel/Netlify project, paid plan, trial, payment method or new production data copy has been created. Application code and deployed infrastructure are unchanged by this review.

## What actually happened overnight

The supplied email arrived on 17 November at 00:45 and reports the five-million-row D1 read limit. Its reset timestamp is 17 November at 00:00 UTC, earlier than delivery. That combination does not establish that a new day's allowance was exhausted; the alert's underlying usage interval remains unconfirmed. A transient block or delayed alert cannot be distinguished without the provider's usage timeline.

Current read-only evidence shows recovery:

- [01:53 hosted discovery run](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43998993124): delivery completed at 01:54 UTC, with 26 review records queued to D1.
- [07:52 queue-processing run](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/44042090137): signed maintenance returned ready and processing completed.
- [08:24 backfill run](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/44046484897): maintenance returned ready, 100 candidates were processed, 80 accepted writes and 20 pending outcomes were recorded, and the run completed.
- A single public `/api/stats` request at **08:40:56 UTC** returned HTTP 200, **2,865 products**, and catalog update time **08:25:41 UTC**, without a snapshot marker. This is 80 above the previous 2,785-product saved catalog.

Thus D1 was functioning at the time of this assessment. This does not erase yesterday's incident or prove an absence of a short overnight interruption. No D1 export, load test, repeated failed query or provider-plan change was performed to investigate this email.

## Current free-plan constraints

| Component | Useful allowance | Constraint for this project |
| --- | --- | --- |
| Supabase Free | Postgres, unlimited advertised API requests, 500 MB database, 1 GB file storage, 5 GB uncached plus a separate 5 GB cached egress allowance | Shared compute/RAM, two active free projects, inactivity pausing after one week, and no included automatic backups. Unlimited API request count does not mean unlimited compute or bandwidth. |
| Vercel Hobby | 100 GB Fast Data Transfer, one million function invocations/month, four active CPU hours/month | Personal/non-commercial usage restriction; feature exhaustion may require waiting for the applicable reset. Replacing a daily hard quota with monthly quotas does not guarantee uninterrupted service. |
| Netlify Free | Commercial projects supported; 300 monthly credits, hard limit, no recharge | Production deployments consume 15 credits; bandwidth, requests and compute share the remaining credits. Twenty production deployments alone would consume 300 credits, before visitor traffic. Our development and enrichment cadence needs deliberate deploy filtering. |

Supabase is a reasonable candidate for relational catalog data and a portable Postgres search/indexing model. It removes dependency on D1's particular row-read quota; inefficient queries can still exhaust compute and affect availability. The present source JSON is only a few megabytes, but that is not a measurement of a migrated database including indexes, private queues, audit history and future growth. Measure the actual Postgres footprint before asserting capacity for a catalog milestone.

Vercel is a workable frontend/API target if the project qualifies for Hobby. Future commercial use requires a plan/host decision; a currently free website is not automatically a non-commercial project. Netlify is an alternative, with a material credit/deployment tradeoff. The existing frontend can remain available during evaluation; database and hosting cutovers need not happen together.

## Concrete migration scope

1. **Portable schema and query layer.** Translate SQLite-specific syntax, timestamps, IDs, conflict handling and transactional batches to Postgres. Replace FTS5/BM25 retrieval with weighted Postgres full-text search and a suitable GIN index. Keep the existing TypeScript intent parser and evidence-aware ranking, then re-evaluate search relevance; different text-search engines will not have identical ordering.
2. **Preserve application behavior.** Reuse React/Vite and the existing Hono route contracts where practical. Replace D1 bindings, Cloudflare Cache/Assets integrations and platform-specific response paths with host adapters. Continue serving compact publisher thumbnails as cacheable public assets rather than consuming database bandwidth for every card.
3. **Preserve private boundaries.** Published identity/evidence data may be public; founder contact details, drafts, moderation blocks, audit records, sessions, signing secrets and encrypted collector journals stay private. Use least-privilege server access, RLS/grants for exposed schemas and server-only secret keys. Keep the current authenticated review and signed ingestion semantics during the port rather than combining an infrastructure change with an unnecessary auth redesign.
4. **Keep collectors autonomous.** Retain bounded standard GitHub-hosted workflows and encrypted checkpoints. Configure their destination to the new ingestion API only after it is verified. No local machine becomes a required scheduler. Add provider-appropriate budget/health checks instead of blindly copying D1 work-unit assumptions.
5. **Import authoritative current state.** The checked-in public snapshot contains 2,785 listings and omits later additions and private state. It is useful for local compatibility testing, not a complete production migration source. Obtain a fresh bounded, private export including queues, aliases, source provenance, blocks and audit history. Inventory schema/version and counts without exposing credentials or private rows in logs or commits.
6. **Verify in parallel.** Check row/provenance/claim counts, referential integrity, role boundaries, admin sign-in and approval, submissions, signed ingestion, duplicate/block handling, previews and the full-catalog search benchmark. Measure real Postgres size, query plans, latency and egress under a bounded representative workload. Only then switch the live endpoint/host and keep a reversible recovery path.

No infrastructure upgrade is required merely to prepare this port. No assertion is made that thousands of new listings per day will fit a free tier; eligible source supply, workload measurements and application indexing still determine throughput.

## Primary references checked today

- [Supabase pricing](https://supabase.com/pricing)
- [Supabase egress accounting](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase full-text search](https://supabase.com/docs/guides/database/full-text-search)
- [Supabase changelog](https://supabase.com/changelog.md)
- [Vercel Hobby allowances](https://vercel.com/docs/plans/hobby)
- [Vercel Hobby plan terms](https://vercel.com/legal/terms#hobby-plan)
- [Netlify current credit plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Netlify's published commercial-use statement](https://www.netlify.com/blog/introducing-netlify-free-plan/) — use the current credit documentation for allowances; the older article's resource allowances are superseded.

The provider-directory lookup was attempted with the current official CLI/plugin; its endpoint rejected the CLI user agent. This review therefore relies on the providers' official documentation and connected documentation tools, not directory-result claims.
