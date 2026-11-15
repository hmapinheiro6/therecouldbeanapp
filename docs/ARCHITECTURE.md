# Architecture

## Request path

A React 19 / TypeScript / Vite / Tailwind application calls Hono JSON routes on the same Cloudflare Worker origin. Static HTML/CSS/JS assets bypass Worker execution. `/api/*`, `/apps/*`, and `/sitemap.xml` invoke the Worker. Product HTML includes escaped, source-backed content for crawlers, then React loads the live API for the interactive detail view. Unknown static routes use a branded 404 document.

D1 holds normalized canonical product records, categories, capabilities, evidence, sources, submissions, ingestion checkpoints/runs, review candidates, temporary rate-limit identifiers, and request nonces. FTS5 is a derived index. Triggers synchronize product, category, capability, publication, and deletion changes. Canonical public JSON/SQL snapshots rebuild the database and index without importing virtual-table exports.

Search performs two bounded queries: FTS retrieval of at most 80 IDs and one indexed capability hydration query. No external website or inference call happens during search. Product detail uses indexed lookups and source hydration. Browser requests have explicit lengths and pagination bounds. Public stats and product APIs return short cache lifetimes; raw search requests are not persisted or cached by application code.

## Discovery path

GitHub Actions on public standard Linux runners -> official HN/GitHub APIs -> bounded Python HTTPS verification -> deterministic capability evidence -> original controlled descriptions -> HMAC signed ingestion API -> atomic D1 batch -> FTS triggers. Unclear or inaccessible candidates remain private. Checkpoints advance only after persisted successful runs. Transient candidates retry with backoff; review candidates need operator action.

No Docker service, Supabase, paid search, paid AI, email delivery service, browser scraping dependency, or always-on machine is required. The local development server is a development tool, not production infrastructure.

## Security boundaries

All public input passes Zod validation. SQL parameters carry user values; FTS expressions contain only quoted normalized tokens. React escapes text. Server-rendered product HTML escapes every field. External product URLs are restricted to public HTTPS formats; fetching is isolated in Python with DNS validation, pinned IP connections, TLS hostname verification, redirect revalidation, robots rules, response/page/concurrency/time limits, and no script execution.

Submission writes require a single-use Turnstile challenge verified server-side for the configured hostname and `submit` action, an application-level token digest replay check, and atomic daily hashed-identifier limits. Internal operations require HMAC SHA-256 over method, exact path/query, timestamp, nonce, and body digest. D1 atomically rejects nonce reuse. Secrets never enter URLs or Git.

## Limits

Search counts describe the retrieved candidate set, not an exhaustive internet count. Unknown audience/qualifiers prevent strong labels. Negation handling is intentionally conservative and does not implement a full linguistic parser. Automated extraction misses products without explicit supported phrases and cannot establish all features. Domain-level deduplication is deliberately avoided; canonical URLs and source IDs preserve distinct products from a parent company.
