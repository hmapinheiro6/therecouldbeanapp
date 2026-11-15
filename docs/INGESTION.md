# Discovery and verification

Run `python3 -m ingestion.run --dry-run --max-candidates 12 --output /tmp/discovery.json` to inspect public sources without catalog writes. Live operation requires `INGESTION_API_URL` and `INTERNAL_SECRET` in the environment and an enabled ingestion API. `python3 -m ingestion.run --max-candidates 40` discovers and writes records, persists run summaries, and advances checkpoints after successful persistence.

Sources:

- **Hacker News**: official Firebase `showstories` and item APIs, at most 30 story fetches per source pass. Show HN titles are candidate leads, not confirmed launches. Original story URLs and timestamps are retained. Repository creation/discovery times never become launch dates.
- **GitHub**: official REST repository search, at most 30 records, creation-time window and relevant topics, description, public website, repository activity/size, and stars as a basic usability signal. Forks, archives, tutorials, templates, and missing websites are excluded. Public unauthenticated API quotas can stop a run safely.
- **Submissions**: at most ten queued submissions per pass enter the same verifier. Approval allows verification; it does not bypass evidence checks or publish immediately.
- **Feeds**: RSS, Atom, and JSON adapters exist. ScrollLaunch and Product Hunt are disabled in `data/feeds.json`. Never enable a feed without a documented permission review and endpoint check.

## Feed investigation on 15 November 2026

The browser retrieval tool could not fetch `https://www.scrolllaunch.com/products/rss.xml` or its robots file. The [terms page](https://www.scrolllaunch.com/terms) was accessible and acknowledges third-party indexing of public maker content, but that alone is not a general license to copy descriptions or imagery. The source remains disabled. Product Hunt's feed is a configurable candidate source but has no completed reuse review and remains disabled. No directory descriptions or logos are copied.

## Fetch policy

`safe_web.py` accepts HTTPS only, disallows credentials/custom ports/literal IP identities, rejects any DNS answer set containing a non-global address, and connects to a validated IP while retaining TLS hostname verification. Every redirect receives the same checks and destination robots review. It allows at most three content pages per domain, three redirect hops, a 10-second network timeout, two bounded network attempts for selected HTTP failures, a maximum eight-second Retry-After delay, two MiB per response, and per-domain spacing. The current verifier normally needs only one page. A source or product that requires authentication, CAPTCHA, or bypass tricks remains pending/review.

The metadata parser reads title, description, headings/body feature text, and JSON-LD without executing JavaScript. Classification needs a confirmed official product identity, usable-software context, and explicit capability evidence. Negative claims, integration lists, comparisons, and announced future features do not establish capabilities. Auto descriptions are original controlled prose derived from evidenced capabilities. Curated seeds have original editorial descriptions and explicit hints checked against the page.

Candidates that temporarily fail retry with exponential day-level backoff, capped at five automatic attempts. Others go to review. Candidate source IDs and canonical URL uniqueness make reruns idempotent. Checkpoints are stored in D1, never an ephemeral runner disk. A run that fails before checkpoint completion may safely rediscover work.

## Observed runs

`data/seeds/verification-report.json` records live official-site seed checks. `docs/discovery-dry-run.json` records an actual API discovery trial, explicitly marked as a dry run: seven candidates, zero automatically publishable, seven needing review. This is not evidence of production publication. Deployment and the live scheduler still require authorization.

No pending/private artifacts are uploaded from Actions. A public source repository exposes ingestion code, taxonomy, and sanitized published seeds only. The `pending` CLI deliberately prints private review records to the operator terminal; never paste it into public issues or upload its output as public workflow artifacts.
