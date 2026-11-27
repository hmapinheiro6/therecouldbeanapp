# Static catalog operations

Public HTML, search, product records, previews, observations and sitemap are Cloudflare static assets. Ordinary browsing and searching call no Worker endpoint and read no D1 rows. MiniSearch runs in the browser; the same evidence-aware ranking keeps website identity checks separate from documented features. Every published product gets an HTML page, embedded public record and structured metadata. Observation JSON is bundled into 256 small shards; product HTML is flat to keep local development practical. The homepage and initial recent listings use a small prebuilt page, loading the complete catalog and search index only when needed. The build reserves headroom below the Free plan's asset limit.

The only permanent Worker routes are `/api/admin/*`, `/api/internal/*` and `/api/submit`. The old public SQL endpoints, D1 FTS index and separate recovery catalog have been retired. D1 remains authoritative for private review, submissions and ingestion.

## Publication and removals

`static-publish.yml` runs after collection/enrichment/moderation workflows, relevant main-branch changes and signed publication dispatches. It exports an explicit public-field allowlist, builds the complete release and deploys it. Successful releases commit the public export for later enrichment jobs. GitHub's workflow concurrency coalesces repeated publication events into the latest waiting release.

Exports read the publication revision before and after their four linear queries. A short lease checks the same revision before deployment and prevents an accepted removal from racing with a deployment. If a release holds the lease, removal returns a retry message before changing the listing.

Unpublishing first stores the review state and publication block in D1, then queues the release workflow. Before the complete rebuild, the workflow can deploy a small blocker using the verified Wrangler deployment path. Only exact removed product paths invoke the Worker and return 410; ordinary published pages stay static. The complete release removes those entries from HTML, search and sitemap and removes temporary routes. This includes workflow and deployment latency; an admin acknowledgement means **queued**, not already removed from the public site. Failed rebuilds retain an activated blocker. More than 45 simultaneous paths, or an unusually long slug, require the full rebuild rather than broad Worker routing.

## Daily database allowance

The 10,000-product expansion now runs on GitHub every two hours, with up to 1,000 official-site checks per run. It resumes the encrypted `state/catalog-expansion` backlog, stops new publication at 10,000, and has no one-day expiry. Each UTC day has a separate 50,000-unit bulk reservation ceiling in addition to the account-wide 70% guard. Ready records survive quota pauses and are retried by a later scheduled run. Routine web/SaaS discovery is not suspended by the bulk campaign. Public release workflows export authoritative records after each run; the retired per-campaign recovery export is not used.

Cloudflare Cron refreshes account-wide provider analytics every 15 minutes, from UTC midnight. Bulk publication pauses at 3,500,000 rows read or 70,000 rows written. Missing or older-than-20-minute telemetry fails closed. Confirmed limit crossings stay paused for that UTC day. These analytics can lag; this is a conservative operational guard, not a hard billing cap. Existing ingestion reservations provide an additional bound.

Every hosted collector and enrichment run also refreshes account usage through a reusable preflight. Imports therefore do not depend on a recent Cron tick. A denied credential or unavailable analytics fails the preflight visibly; it does not reopen the allowance. Web/SaaS collection can still seal its encrypted queue if database preparation is unavailable.

The initial confirmed pause is dated 2026-11-17 and expires automatically at UTC midnight. Jobs still need fresh analytics after that reset. Moderation and public static releases retain access to the reserved allowance; public browsing needs none.

Each Worker query logs provider `rows_read` and `rows_written`, a job label and ordinal, without SQL values. Signed responses expose aggregate counts for hosted-job ledgers. Jobs fail when their configured read budget is exceeded. CI also measures real local D1 query metadata against a 5,000-product fixture; this caught and fixed a canonical-URL lookup that was scanning every published row. Published counts now use an indexed counter rather than repeated `COUNT(*)` scans. The admin page no longer reloads catalog aggregates for every search keystroke.

## Independent monitoring

The Worker Cron runs every 15 minutes independently of Actions schedules. It checks recent successful collection/intelligence jobs, nonexpiring collector checkpoint provenance and the last verified encrypted database backup. It opens one deduplicated GitHub issue when attention is needed and closes it after recovery. Issue alerts require the server-side GitHub credential below.

This repository is public. A weekly real heartbeat commit keeps it active within GitHub's 60-day inactivity window. Workflows are guarded against silently running as paid private-repository jobs.

## Durable private state and backups

`state/cloud-discovery` and `state/catalog-expansion` contain only current/previous AES-GCM ciphertext and public provenance. Replacements use isolated parentless commits, so branch history does not grow with every checkpoint. The latest checkpoint does not expire. Existing Actions artifacts are only a first-migration fallback; new runs save to the state branch. Restore authenticates the ciphertext and verifies its original trusted workflow, repository, branch and run identity before opening the outbox.

The daily 03:07 UTC backup exports the **entire D1 database**, including private tables, adds both encrypted collector checkpoints, encrypts the bundle under a separate HKDF context, verifies a restore, and writes it to the private `therecouldbeanapp-private-operations` R2 bucket. Fourteen rotating daily slots plus `latest.enc` bound storage. Plaintext, signed export URLs and keys are never uploaded to Actions artifacts or printed. Temporary plaintext files are deleted with the ephemeral backup directory. Keep the encryption root (`INTERNAL_SECRET`, including previous versions after rotation) in a separate secure recovery location.

A real full export has been restored and integrity-checked in a **new isolated local D1 database**, preserving private tables. Both real checkpoint ciphertexts also survived the encrypted-bundle round trip byte for byte. Hosted runs separately authenticate collector journals with the production secret. No remote restore database was populated, preserving today's production write allowance.

## Required account setup

Local deployment access does not grant autonomous runners or the Cron access. Configure these [repository Actions secrets](https://github.com/hmapinheiro6/therecouldbeanapp/settings/secrets/actions):

- `CLOUDFLARE_API_TOKEN`: restricted to the existing Cloudflare account, with Workers Scripts Edit, D1 Edit, Account Analytics Read and Workers R2 Storage Edit. No DNS or registrar access is needed.
- `WATCHDOG_GITHUB_TOKEN`: restricted to this repository, with Actions read/write, Issues read/write and Contents read.
- `INTERNAL_SECRET` already exists and remains the signing/encryption root.

Enable R2 in the existing Cloudflare account. The backup job creates its private bucket when access is available. Deployment installs the two operations credentials as Worker secrets, enabling account analytics and independent alerts. Until access is configured, workflow preflight reports setup required and skips deployment/backup without claiming success. A successful backup writes only a small public health timestamp and integrity status to `data/backup-health.json`.

Run **Publish static catalog** after configuring the secrets, then **Encrypted full database backup** to verify the first durable R2 backup immediately. Their normal triggers handle subsequent work without a local computer.
