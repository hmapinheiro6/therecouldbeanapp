# Catalog expansion and review dashboard

Verified 16 November 2026. [Live catalog](https://therecouldbeanapp.henriquepinheiro.workers.dev/explore) · [Private review dashboard](https://therecouldbeanapp.henriquepinheiro.workers.dev/admin/).

## Actual publication

Production D1 contains **2,785 published products**: **2,732 official-identity listings** and **53 listings with verified capability evidence**, totaling **73 verified feature claims**. There are **39 categories and 69 capability definitions**; definitions are vocabulary, not proof of coverage. No synthetic records were added to production.

Two cloud backfills completed successfully:

| Source             | Websites processed | Accepted writes | Pending | Cloud run                                                                                 |
| ------------------ | -----------------: | --------------: | ------: | ----------------------------------------------------------------------------------------- |
| Homebrew Cask      |              2,000 |           1,599 |     401 | [43844794785](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43844794785) |
| Awesome-Selfhosted |              1,183 |           1,052 |     131 | [43844791129](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43844791129) |

Accepted writes are not unique new products: canonical URLs can overlap across sources. The published total comes from D1. An earlier partial Homebrew run persisted 96 products before encountering malformed HTML metadata; that failure remains recorded. The parser and failure isolation were corrected before the successful runs above. Source counts, dates, and scope are retained in the sanitized `data/seeds/published-snapshot.json`.

The sources offer real software, including desktop applications and self-hosted web applications, rather than only recently launched commercial SaaS. Homebrew descriptions use BSD-2-Clause attribution; Awesome-Selfhosted descriptions use CC-BY-SA-3.0 attribution and share-alike terms. See `data/LICENSE.md`, the distributed notices under `public/licenses/`, and each product's Sources section. Fonts, disabled/deprecated casks, version variants, non-application installers, duplicate URLs, and insufficient official identities are filtered or held.

Official identity checks confirm the named product on its actual public website. They do **not** certify all directory feature claims. These products have no inferred capability rows, are visibly labelled, and appear as Related when only wording matches. Existing capability evidence is protected against automatic directory overwrites. Exact-name results can be Strong because the explanation explicitly states a name match. Adding feature evidence remains a separate review task.

## Approving and editing

Open **/admin/** and sign in with the operator's separate admin access key. The deployment key is stored only in provider secret storage and a private, ignored local access file; no key is included in this repository. It is distinct from the ingestion signing secret.

1. Choose **Discovered apps** or **Founder submissions**; select an entry.
2. Open its official website and discovery source. Correct its name, official URL, description, category, and identity excerpt.
3. Keep **Official identity checked** when feature evidence is incomplete. To verify capabilities, choose that scope and add each capability with its exact official URL and a concise supporting excerpt.
4. Enter a review note, confirm the source check, then choose **Approve and publish**. Publication updates D1 and search immediately. **Save draft**, **Retry automatically**, and **Reject** are available for discovered apps.
5. Choose **Published catalog** to edit any existing listing. Public slugs stay stable; corrected official URLs retain deduplication aliases. **Unpublish** removes the public record and search result while preserving a block against automatic republication. Reinstatement requires an explicit editorial approval.

The browser uses eight-hour opaque, hashed, HttpOnly/Secure/SameSite sessions. The server checks exact Origin on mutations, rate limits failed sign-ins, validates official evidence hosts, records review actions, and excludes emails from dashboard responses. Admin pages are noindex; review records and screenshots are not public workflow artifacts. Rotating `ADMIN_SECRET` invalidates existing sessions. Missing configuration fails closed.

A real queued YVD listing was reviewed through the production browser, corrected to video generation using official evidence, and published at its stable public slug. Existing Otter details and feature excerpts also load correctly into the published-catalog editor. Automated tests cover direct publication, URL correction, index updates, unpublishing, invalid taxonomy preserving blocks, and explicit reinstatement.

## Continued discovery

- Recent Show HN launches, GitHub software repositories, submissions, and due retries: **every six hours at minute 17 UTC**, up to 100 candidates per run.
- Homebrew Cask: **every six hours at minute 35 UTC**, up to 500 previously unseen eligible websites per scheduled run.
- Awesome-Selfhosted: **daily at 02:45 UTC**, up to 500 previously unseen eligible websites per run.

Manual backfills support up to 2,000 websites, with eight workers in Actions. Persisted known URLs, publication blocks, review states, retry backoff, and URL aliases prevent repeated imports from inflating the catalog. Robots, public DNS/TLS checks, response/time budgets, and access restrictions remain enforced. Authenticated or blocked pages stay held; no JavaScript or CAPTCHA bypass is used.

GitHub schedules are best effort and require maintenance. Source directories have finite coverage; no claim of indexing every SaaS or verifying every feature is made. Refreshing these directories mainly finds new entries after the initial backfill. Recent-launch discovery runs separately.

## Verification

**120 automated cases pass:** 43 TypeScript/search/API/database, 63 Python ingestion/security, and 14 desktop/mobile browser cases. Lint, strict TypeScript, build, nine migrations, and portable snapshot restoration pass. The full restored catalog has 2,785 products and 2,785 FTS records, no foreign-key violations, and SQLite integrity `ok`. The restoration preserves aliases, all source provenance, verification scopes, feature evidence, announced dates, and search aliases.

A fresh 60-query production check at this size returned **zero HTTP errors**, network p50 **233.62ms** and p95 **431.95ms**. This verifies availability, not semantic precision across thousands of newly added descriptions. The original 60-case relevance judgments remain a small curated-seed evaluation and are not extrapolated to the new catalog. See `catalog-scale-search.json` and `catalog-scale-cpu.json` for measured windows. Cold CPU spikes above the native Free allowance remain a limitation; no upgrade or payment method was added.

After moving ICU collation initialization outside request-time sorting and retaining up to 1,024 public normalized documents, a separate final 60-query window again had zero HTTP errors: network p50 **217.75ms**, p95 **411.02ms**. Provider metrics observed 59 requests within the second-resolution window, with CPU p50 **4.134ms**, p99 **11.840ms**, and zero errors/subrequests. This improves the observed tail but remains above the native 10ms allowance. Both measurement windows are retained; no sustained Free CPU guarantee is claimed. Final production smoke and deployment version are in `catalog-scale-proof.json`.
