# Discovery and interface update — 16 November 2026

[Live catalog](https://therecouldbeanapp.henriquepinheiro.workers.dev/explore) · [Cloud discovery run](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43835259508)

The catalog now has **52 published products and 72 verified capability claims**: 45 curated seed products and seven discovered products, including Pizza from the initial run. This iteration added **six retained new listings**: Orty, Sauron, Scatter, Enzo, Lumora, and Savora. Actual exported names, official URLs, evidence, timestamps, and original discovery provenance are in `data/seeds/published-snapshot.json`.

## How it grows

1. Every day at **04:17 UTC**, a public GitHub Actions runner collects recent Show HN posts and newly created GitHub projects in separate SaaS, productivity, and developer-tool streams. Founder submissions enter the same pipeline.
2. The Show HN collector reads a chronological time window instead of taking the first 30 ranked IDs. Timestamp/story-ID checkpoints retain unconsumed leads. GitHub uses creation-day pagination and its own checkpoints for each topic. There is **no GitHub star requirement**.
3. The verifier fetches official public product pages, respects access restrictions, confirms identity, and saves explicit capability evidence. A mention in a launch post is insufficient. Ambiguous, inaccessible, and unsupported products remain outside search for review.
4. Verified records enter D1 and FTS automatically. Homepage cards and Explore show **recent catalog additions** with dates; A–Z remains available. An addition date does not establish a product's launch date.

The pipeline processes at most **100 candidates per run**. A busy source cannot consume the entire source budget. It starts with a short backfill and carries remaining leads forward, so it is a bounded collector rather than an exhaustive launch index. Checkpoint lag needs operational monitoring. GitHub/Show HN have selection bias; additional permitted feeds and founder submissions are needed for broader closed-source SaaS coverage. Product Hunt and ScrollLaunch are still disabled pending clearance.

## What the live run proved

The cloud run completed **08:58:48 UTC** with **100 candidates processed, nine accepted by its then-current policy, 91 pending, and zero rejected**. It persisted D1 updates and all four new source checkpoints. The public repository had previously become private and its cost guards skipped jobs; public visibility was restored with the operator's approval.

An evidence audit then held three misclassified listings: YVD, DownForReal, and IndexFast. Their prompt examples, pricing/customer-support text, or search-engine directory headings did not substantiate the capabilities assigned by the classifier. These are real leads needing appropriate taxonomy/evidence review, not fabricated products. Their public detail APIs now return 404. The six retained products were fetched again; Enzo's follow-up email label was removed, and only its supported meeting capability remains. Original discovery provenance and first-seen dates were preserved.

The final classifier has regression checks for these failures, including founder biographies, third-party storage, CI security checks, video generation versus editing, pricing, directories, prompt examples, and follow-up email versus reminders. This improves precision but does not make automatic classification infallible. Its narrow vocabulary deliberately leaves unfamiliar product types for review rather than inventing capabilities.

`discovery-production-proof.json` records the final public count, six new entries, official evidence/provenance checks, recent sorting, live search, and held-record 404s. `production-smoke.json` retains earlier checks and the latest release evidence.

## Interface and verification

Removed the top header/navigation, heading eyebrows, decorative figure/file numbers, generic verification badges, and the entire closing stamp/manifesto. Useful links remain in the footer. The blueprint palette, grid, pixel type, and original computer drawing remain.

Verified the deployed desktop and 320px mobile layouts, accessible form labels, live recent listings, and absence of header/eyebrow/stamp elements and horizontal overflow. Screenshots: `simplified-homepage-desktop.jpg`, `simplified-homepage-mobile.jpg`.

**108 automated cases:** 37 TypeScript/backend/search, 59 Python ingestion/security, and 12 desktop/mobile end-to-end cases. Public [CI](https://github.com/hmapinheiro6/therecouldbeanapp/actions/workflows/ci.yml) also runs lint, strict types, build, and the existing benchmark. Earlier search measurements remain dated baseline measurements; this update does not claim a new precision score or a larger independently judged benchmark.
