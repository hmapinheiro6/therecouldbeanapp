# Deployment

Production is deployed on Cloudflare Workers Free at [therecouldbeanapp.henriquepinheiro.workers.dev](https://therecouldbeanapp.henriquepinheiro.workers.dev). Public source: [hmapinheiro6/therecouldbeanapp](https://github.com/hmapinheiro6/therecouldbeanapp). Verified 15 November 2026.

## Current resources

- Worker: `therecouldbeanapp`; account `272cf24b9368ff4a4c6833562cae0f0d`.
- Isolated D1: `therecouldbeanapp-catalog`, ID `2a24c33c-ee1f-4dba-b601-39f00232e3ea`, binding `DB`; migrations 0001–0009 applied.
- Free managed Turnstile widget for the deployed hostname; public sitekey in `wrangler.jsonc`.
- Worker secrets: `ADMIN_SECRET`, `INTERNAL_SECRET`, `RATE_LIMIT_SALT`, `TURNSTILE_SECRET_KEY`, supplied through provider secret storage.
- Repository secret `INTERNAL_SECRET`; variables `INGESTION_API_URL` and `DISCOVERY_ENABLED=true`.
- Public submissions and daily discovery enabled. The manual discovery run and actual browser Turnstile duplicate check passed.
- Privacy/support contact: `support@therecouldbeanapp.com`, supplied by the operator. Mail delivery was not tested.

The dashboard showed **Free / $0 / Current plan**. No plan upgrade, paid dependency, domain purchase, or unrelated database binding was performed. Wrangler's custom CPU override is omitted because Free rejects it; the native 10ms allowance applies. Real measured CPU tails exceed that allowance; see `COSTS.md` before growing traffic.

## Deploy updates

Use Node 24, the intended authorized Cloudflare account, and the checked-in configuration. Run tests before deployment. Migrations are tracked and safe to rerun.

```sh
npm ci
npm run lint
npm test
.venv/bin/python -m pytest tests/ingestion -q
npm run build
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

Do not rerun the seed import as an everyday deployment step: it is initial/recovery data and may replace revised facts. The API does not depend on a local server. The source workflow runs CI and discovery; Worker deployment is currently an explicit Wrangler action, not automatic on every push.

## Reproduce in a different account

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create therecouldbeanapp-catalog
```

Confirm **Workers Free**, create a new isolated database, then replace the account/database IDs in `wrangler.jsonc`. Apply migrations and import `data/seeds/catalog.sql` once for initial seeds. Set `SITE_URL` and `TURNSTILE_HOSTNAME` to the actual deployed origin/hostname. Create one Free managed Turnstile widget for that hostname; set its public sitekey. Never use test keys or a bypass in production.

Generate separate random values of at least 32 bytes for the signing secret and rate salt. Enter these through provider prompts; never put them into Git, workflow variables, URLs, or public logs.

```sh
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Set the matching signing secret in GitHub Actions secret storage. Configure `INGESTION_API_URL` to the deployed origin and `DISCOVERY_ENABLED=true` after a manual successful run. Use a public repository and standard runners to preserve free eligibility. Keep private queues, emails, `.dev.vars`, `.env`, and credentials out of source and workflow artifacts.

Only enable `SUBMISSIONS_ENABLED` after the correct hostname/widget/secrets and actual privacy contact are configured. Local submission and ingestion endpoints fail closed without secrets. There is no production test bypass.

## Smoke checks and monitoring

```sh
curl --fail https://therecouldbeanapp.henriquepinheiro.workers.dev/api/health
curl --fail https://therecouldbeanapp.henriquepinheiro.workers.dev/api/stats
curl --fail --get --data-urlencode 'q=meeting transcription and action items' https://therecouldbeanapp.henriquepinheiro.workers.dev/api/search
```

Check a product URL directly for escaped useful HTML, correct canonical/social URLs, sitemap, missing-page 404, search noindex, and real Turnstile validation. Inspect the latest discovery job and persisted D1 run/checkpoints. Watch account-wide Worker requests/CPU, D1 reads/writes/storage, and scheduler health. Free exhaustion can return platform errors. Reduce batches or disable `DISCOVERY_ENABLED` if needed; do not upgrade automatically.

## Custom domain

The operator confirmed that `therecouldbeanapp.com` is **not registered**. It is not connected; the working workers.dev deployment remains the public address. The supplied support email does not establish domain-control authorization. Once the owner confirms DNS control, attach the authorized custom domain to this Worker, update `SITE_URL`/`TURNSTILE_HOSTNAME`, add the exact hostname to the widget, redeploy, and repeat smoke checks. Domain registration and email hosting are separate and were not purchased/configured.
