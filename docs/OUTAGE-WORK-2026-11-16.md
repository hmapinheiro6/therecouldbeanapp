# Work completed during the D1 daily block

The public catalog remains **2,785 entries**. No production D1 reads or writes were made for this work. Search and quota-protection code was deployed; new editorial material remains private and unpublished.

| Workstream | Completed result |
| --- | --- |
| Existing product evidence | 60 distinct official product sites reviewed; 30 private feature drafts with 44 proposed supporting excerpts; 30 held. Repeated development rechecks are not counted as additional products. |
| Smaller web/SaaS discovery | 420 source candidates, eight duplicates against the saved public catalog/local journal, 412 unique leads (180 HN, 232 GitHub). Of 300 official-site checks, 14 produced identity-only review drafts and 286 were held; 112 leads remain unchecked. Zero approved features or publications. |
| Search | Restored all 2,785 exported products locally. Forty judged regression queries improved from 37 to 40 passing in SQLite, and 33 to 40 in saved-catalog search. Fixed non-Latin names, missing alias matches, and incidental-word false matches. These are engineering regression judgments, not a whole-market relevance score. |
| Quota safeguards | Atomic daily project import reservations, shared workflow concurrency, immediate budget-error stop, guarded atomic snapshot replacement, full-export query-plan and execution-work checks in CI. Reservations estimate project work and do not guarantee account-wide provider limits. |

Both offline tools retain private atomic checkpoints and use the existing robots/DNS/TLS/response-size safeguards. Discovery tightened web-availability checks, holds unproven redirects and descriptive headlines, and keeps all extracted feature proposals unapproved. GitHub restricted access during the second collection batch; those source cursors were retained without bypassing the restriction. D1's private queue could not be consulted, so recovered imports must deduplicate again.

Private artifacts remain under ignored `.ingestion-state/`, with directories `0700` and files `0600`. `WORK-REVIEW.md` is a readable index of the 30 existing-product edits and 14 new-product drafts, including official evidence and discovery provenance. Existing-product drafts are in `evidence-audit-2026-11-16-reviewed/drafts.json`; discoveries are in `offline-discovery-drafts.json`. No draft files or their contents were committed to the public repository.

Validation: **133 TypeScript/API/search/database cases, 108 Python ingestion/security cases, and 16 desktop/mobile browser cases passed** (257 total). Lint, strict TypeScript, build, original seed benchmark, the new full-catalog benchmark, and the local query-work check passed. The four export queries used approximately 130,000 local SQLite VM instructions; this is not billed D1 rows. Independent review found no reservation fail-open or authentication bypass; its count-fixture and nonce-write wording corrections were applied.

The deployed static HTML, application asset and public snapshot were checked against the tested build without calling the production database. Migrations **0010** and **0011**, normal admin sign-in and actual publishing remain pending until D1 resets. Existing signed scheduled maintenance applies and records both migrations on its next successful run. Keep using [the incident report](DATABASE-QUOTA-INCIDENT.md) for that outstanding limitation.

Implementation and operating instructions: [official evidence audits](OFFLINE-EVIDENCE-AUDIT.md), [offline discovery](OFFLINE-DISCOVERY.md), [full-catalog search](FULL-CATALOG-SEARCH.md), and [import/export safeguards](INGESTION-BUDGET.md).
