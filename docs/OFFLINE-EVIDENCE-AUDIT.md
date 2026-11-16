# Official feature evidence while D1 is unavailable

`ingestion.evidence_audit` prepares private review drafts from the exported public
catalog without importing the internal API client, contacting D1, approving
records, or changing the published snapshot. This is useful during a database
quota incident and for bounded editorial work at any time.

```sh
.venv/bin/python -m ingestion.evidence_audit \
  --limit 60 --workers 6 --max-seconds 300 \
  --output .ingestion-state/evidence-audit-2026-11-16-reviewed
```

The default input is `data/seeds/published-snapshot.json`. Only identity-only web
applications without existing feature claims are eligible. Directory wording
prioritizes candidates; it never supplies capability evidence. Official product
sites precede repository pages. This is a targeted editorial batch, rather than a
representative measure of coverage across the catalog.

Each product is fetched through the existing `SafeWeb` robots, public DNS, pinned
TLS, redirect, response-size, delay, and three-content-pages-per-domain guards.
Checks on the same hostname are serialized and share the page allowance. The
existing conservative feature extractor requires a confirmed name, usable
software identity, and explicit official feature wording. A redirect to another
hostname is held for manual identity review. There is no JavaScript, login, or
CAPTCHA bypass. The duration option stops starting checks after the limit;
bounded requests already in flight are allowed to finish.

An additional audit precision gate rejects short labels, first-person quotes,
future promises, integration destinations, and promotions for another product.
Interface design requires interface/UI/wireframe wording; screen sharing alone
does not establish remote access, and distributed version control alone does not
establish code hosting. These guards deliberately favor fewer, clearer drafts.

The ignored output directory has owner-only permissions. Its files are created
with mode `0600` and atomically replaced:

- `checkpoint.json`: snapshot fingerprint and every prepared/held outcome.
- `drafts.json`: proposed product edits, exact supporting excerpts, official
  source URLs and check dates, content fingerprints, and held reasons.
- `summary.json`: actual checks, prepared drafts, held records, proposed claims,
  and a publication count that is always zero.

Reusing the directory resumes the same snapshot and skips completed attempts,
including held results. `--limit` bounds new attempts in each invocation. A changed
snapshot or evidence-policy version is refused; use a new dated output directory
for a fresh snapshot or an intentional recheck. Outputs outside ignored
`.ingestion-state/` are refused.

Drafts retain the product's stable slug, canonical URL, licensed description,
category, original dates, aliases, and all discovery sources. Proposed capability
claims carry fresh official evidence; the existing published listing remains
untouched. A prepared draft is explicitly marked `needs_operator_review` and
`unpublished_draft`. It is not an editorial approval or a claim of live coverage.

Once the private dashboard is available, open the published listing using the
draft's slug. Review each official page and excerpt, remove ambiguous or obsolete
claims, select the verified-capabilities scope, and copy the reviewed feature
evidence. Record the review note and use **Approve and publish**. There is
deliberately no automatic upload command in this audit tool. Evidence can become
stale; recheck it before approval when publication is delayed.

Focused verification:

```sh
.venv/bin/python -m pytest tests/ingestion/test_evidence_audit.py -q
```

## Batch checked on 16 November 2026

Using the public export dated `2026-11-16T10:23:03.397Z`, the final policy-3 batch
checked **60 distinct existing products**, prepared **30 private review drafts**
with **44 proposed official feature excerpts**, and held **30 products**. No
products or feature claims were published. Earlier policy-development rechecks
cover the same products and are not additional distinct checks.

The final files are in ignored
`.ingestion-state/evidence-audit-2026-11-16-reviewed/`. Their exact URLs, excerpts,
timestamps, source fingerprints and reasons remain private. A manual excerpt pass
held a third-party article reference, and trimmed unrelated navigation suffixes
from two otherwise direct product descriptions. All remaining drafts still
require operator approval. The intermediate `evidence-audit-2026-11-16/` and
`evidence-audit-2026-11-16-strict/` directories are development outputs and should
not be used for publication.

Holds include restricted or insufficient pages, identity ambiguity, cross-host
redirects, absent explicit claims, and ambiguous feature meanings. A hold does
not mean the product lacks the feature; it means this bounded public-page check
did not establish adequate evidence for a proposed edit.
