# Catalog growth: measured constraints and proposed next implementation

Assessed 16 November 2026 from repository code, the saved published catalog and two current public source feeds. This document is a proposal. It does not increase production import limits, approve products or add a provider.

## Clear public statuses

- **Official website checked · Features not verified**: the product identity was matched to its official site. No scheduled review, hands-on test, availability guarantee or feature verification is implied.
- **Features documented**: the listed capabilities have supporting official-source excerpts. This is neither hands-on testing nor an exhaustive feature inventory.
- **Publisher description / Website preview**: optional publisher metadata for presentation. It never becomes feature evidence or affects ranking.

These phrases are used across cards, product pages, admin options, About and server-rendered/search-engine product summaries. Internal database values `identity` and `capabilities` remain stable. Queue statuses describe actual operator work separately.

## Current supply and throughput

The saved published snapshot has 2,785 software products. It is not a count of 2,785 commercial SaaS offerings: desktop apps and self-hosted software account for much of its coverage.

A fresh bounded read of the two existing directory feeds found:

| Source | Eligible entries under our current parser | Canonical URLs absent from the published snapshot |
| --- | ---: | ---: |
| Homebrew Cask | 3,230 | 1,514 |
| Awesome-Selfhosted | 1,188 | 132 |

These are **source leads, not approved additions**. The comparison uses canonical published URLs, not the private known/held/rejected/alias records. Sources may overlap; stale entries, aliases, restrictions and failed identity checks will reduce the net yield. No product websites were fetched and no production D1 queries were made for this supply assessment. The existing feeds alone cannot supply a ten-thousand-product catalog.

`worker/ingestion-budget.ts` reserves 20,000 shared estimated work units each UTC day. An identity-only product plus its candidate checkpoint consumes 80 + 12 = 92 units. Even if nothing else consumed the budget, that allows only 217 such imports/day; ordinary queues, run updates and other imports lower it. These units are a project safeguard, **not Cloudflare billing rows**. The manual 2,000-candidate ceiling does not override this daily guard.

Cloudflare currently documents 5 million D1 reads/day and 100,000 writes/day on Free. Indexes and FTS amplify writes, and the quota is shared with other account activity. Simply raising concurrent jobs or candidate inputs does not produce a safe publication burst. Standard public GitHub-hosted runners remain free, but artifact/cache storage has separate accounting.

The preview collector also has a deliberate ceiling of 4,000 JSON files/128 MiB. At larger catalog sizes it should keep bounded rotating coverage of new/popular products or move to sharded preview bundles after measurement. Raising that ceiling without checking repository growth, deployment file counts and asset budgets would be incomplete.

## Proposed staged growth

1. **Expand source coverage before increasing speed.** Add a source registry recording terms/license, provenance, product type, cursor, last successful run, unique leads and actual publication yield. Prioritize permitted commercial web/SaaS feeds and curated lists to balance the existing desktop/self-hosted coverage. Treat Show HN/GitHub mentions as leads; a repository is not necessarily an app or a SaaS. Do not assume a public directory grants bulk metadata reuse.
2. **Separate collection, identity checks and database delivery.** Extend the existing encrypted hosted checkpoint/outbox model to licensed bulk backfills. Collect and deduplicate bounded lead batches independently of D1 availability; retain checked results across quota pauses so fetching is not repeated. One serialized drainer publishes within the shared budget. Use canonical URLs, alias mappings and stable product identity, without collapsing every product on a shared domain into one record.
3. **Keep publication and feature evidence separate.** Continue automatic identity-only publication for eligible licensed sources that pass the existing policy. For additional feeds, define publication eligibility explicitly: software product, permitted provenance, unambiguous official identity, no duplicate/block, usable attributed description. Hold ambiguous cases for human review. Never require a person to research every straightforward identity, and never promote publisher marketing into documented features. A separate bounded hosted evidence job should prepare reviewable feature excerpts, prioritizing software relevant to common task categories; discovery does not need to wait for that review.
4. **Measure and then ramp delivery.** Begin within the existing approximate 200/day publication envelope. Record provider row accounting for representative imports, including indexes/FTS, queue writes and signed-request bookkeeping, and confirm the pending quota fixes after the UTC reset. Only then tune the shared allowance toward a trial 500/day if actual headroom supports it. Reserve capacity for visitors and moderation; defer and resume at quota boundaries. A candidate collection target is not a publication promise.
5. **Measure useful coverage.** Report unique new published products/day, source-specific rejection/duplicate/hold rates, web/SaaS vs desktop/self-hosted counts, missing categories, documented-feature coverage, source freshness, quota use and delivery backlog. Use aggregate operational metrics and fixed benchmark queries; avoid storing visitors' raw app ideas just to choose priorities. Test category/task coverage with the saved full catalog rather than extrapolating from the curated seed search benchmark.

A 10,000-product catalog is a milestone, not a current capacity promise. From 2,785, the gap is 7,215 products: 37 days at 200 net new/day, or 15 at 500/day, **only if sufficient eligible unique supply exists**. The present sources do not establish that supply and the higher publication rate is not yet measured. Gathering thousands of leads can happen ahead of publishing; represent the two counts separately.

## Primary platform references

- [Cloudflare D1 pricing and read/write accounting](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [GitHub Actions runner and storage billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Existing Homebrew API](https://formulae.brew.sh/api/)
- [Existing Awesome-Selfhosted source](https://github.com/awesome-selfhosted/awesome-selfhosted)
