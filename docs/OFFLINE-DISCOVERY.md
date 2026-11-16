# Offline discovery during a database outage

`ingestion.offline_discovery` uses the existing public Show HN and GitHub topic adapters to prepare private review drafts. It never imports `InternalClient`, calls the production API, updates D1, or publishes a record. The public catalog remains unchanged.

Run from the repository root:

```sh
.venv/bin/python -m ingestion.offline_discovery \
  --lookback-days 30 --max-candidates 120 --max-verify 100 --windows 7 --workers 6
```

The first run starts the source cursors 30 days back. Later runs resume `.ingestion-state/offline-discovery.json`; changing `--lookback-days` does not reset an existing journal. `--verify-only --max-verify 100` checks the next saved pending leads without fetching source APIs again. `--max-verify 0` collects leads without fetching their websites. A separate journal path can intentionally examine a different time window. The module bounds source day windows, returned candidates, verification count, workers, response sizes, redirects and per-domain content pages.

Each source response and its updated cursor are saved together using an atomic file replacement, before the next response is requested. A private writer lock prevents concurrent CLI runs from overwriting the same journal. A source failure leaves its cursor intact and allows other sources to proceed. Matching canonical URLs, known public URL aliases, repeated source IDs and duplicate URLs across sources are skipped. Pending records are compared with the latest supplied snapshot again before verification. This cannot deduplicate against the private production queue while D1 is unavailable; imports must perform that final check after recovery. Distinct product paths remain distinct.

Official-site checks use `SafeWeb`: HTTPS, validated public DNS, pinned TLS, robots rules, bounded redirects, a shared three-page maximum per hostname and a per-host delay. Access restrictions, denied robots, missing identities, descriptive headlines, desktop-only products and insufficient evidence are held for review. An explicit affirmative public web/SaaS availability excerpt is required before a draft is prepared; signup links, browser demos, native-app authentication and mentions of SaaS as an industry are insufficient. These rules can miss valid products and do not claim exhaustive discovery.

All new-product drafts are **identity-only** with zero approved capabilities and neutral descriptions. Any automatically extracted feature proposals are retained separately as unreviewed private material. They require a later editorial decision and must not be imported as verified claims. The extractor also uses the evidence audit’s precision gate to reduce integration, testimonial and future-promise noise. Cross-host redirects require manual identity review. Saved drafts from an earlier run are re-audited offline before export. Neither source dates nor repository creation dates are presented as product launch dates. A candidate from an older source window is a newly found lead, not necessarily a newly launched product.

The journal and `.ingestion-state/offline-discovery-drafts.json` are ignored by Git, use file mode `0600` and directory mode `0700`, and cannot be directed outside `.ingestion-state/`. The draft file contains public-source material awaiting review, plus provenance and evidence. Standard output contains counts and bounded source errors, not product details or credentials. No credentials are needed for this path. Do not commit the journal or drafts to the public repository.

The final summary separates source candidates, duplicates, unique saved leads, checked records, capability drafts, identity drafts, held records and still-pending records. All publication counts are zero. Hold reasons and original source URLs remain available in the private journal so an operator can make a concrete decision rather than silently discarding a lead.

GitHub may return public-API access/rate restrictions during a larger batch. The collector records that source error, keeps the last durable cursor and makes no bypass attempt. Other sources can continue. The journal is scoped to this project; it cannot confirm the production private queue while D1 is blocked.

On 16 November 2026, two bounded collection runs returned 420 source candidates: 8 duplicates were skipped and 412 unique leads were saved (180 Show HN, 232 GitHub). Exactly 300 official-site checks were attempted. After offline identity, redirect and availability review, 14 identity-only review drafts remain, 286 leads are held and 112 are pending. No records were published. GitHub denied access during the second run; the collector stopped those streams without bypass and preserved their cursors. The earlier batch used a fresh SafeWeb per candidate; the reusable implementation now shares the three-page host budget and delay across candidates. No further live checks were performed after the hardening.
