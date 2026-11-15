# Deployment

No production deployment is claimed. The checked-in database ID is deliberately a placeholder. Current prerequisites are an authorized Cloudflare account on **Workers Free**, its workers.dev subdomain, a public GitHub repository, a real Turnstile widget, and a completed operator/privacy contact.

## 1. Account and isolated database

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create therecouldbeanapp-catalog
```

Select the intended account; inspect the dashboard to confirm Workers Free. Do not upgrade a plan. Record the new database ID in `wrangler.jsonc` under the `DB` binding. Create only this project's database; never bind an existing unrelated application's storage. Opening Workers & Pages for a new account initializes a workers.dev subdomain. No custom domain is needed for the initial deployment.

```sh
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 execute DB --remote --file=data/seeds/catalog.sql
npm run build
npx wrangler deploy
```

Record the returned HTTPS workers.dev URL. Set `SITE_URL` to that exact origin and `TURNSTILE_HOSTNAME` to its hostname, then redeploy. Do not configure `therecouldbeanapp.com` until ownership and DNS authorization are confirmed. No code registers or purchases a domain.

## 2. Secrets and submissions

Generate **separate** random values (at least 32 random bytes) for `INTERNAL_SECRET` and `RATE_LIMIT_SALT` using your password manager or cryptographic generator. Put them in provider-managed secrets, never in Git or workflow variables.

```sh
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put RATE_LIMIT_SALT
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Create one Free Turnstile managed widget for the deployed hostname. Set its public sitekey in `TURNSTILE_SITE_KEY`. The backend verifies hostname and `submit` action and stores no raw IP address. Official Turnstile test keys are for local/testing only; never set them in production. There is no production bypass.

Before enabling public submissions, replace the preview-only operator text in `/privacy` and `/terms` with the real operator identity, privacy contact, retention responsibility, and jurisdiction. Turn on `SUBMISSIONS_ENABLED` only after those changes, the widget, and secret setup. `INGESTION_ENABLED` can be set to `true` once the signing secret exists. Rebuild/redeploy after changes.

## 3. Public GitHub Actions

Use a new, separate public repository. Publishing this repository makes the ingestion code, taxonomy, and sanitized published catalog public. It must never include `.dev.vars`, `.env`, submission emails, moderation dumps, or credentials. The workflows are guarded to public standard runners and do not create artifacts.

Repository configuration:

- Secret `INTERNAL_SECRET`: exactly the Worker signing secret.
- Variable `INGESTION_API_URL`: deployed origin, e.g. the actual returned workers.dev URL (no trailing `/api`).
- Variable `DISCOVERY_ENABLED`: `true` after a successful manual run.

Run **Daily public product discovery** manually once. Check the signed API result, D1 `ingestion_runs`, candidates, checkpoints, and the actual catalog count. The schedule is 04:17 UTC daily; timing is best effort. CI runs on pushes and pull requests. Never put Cloudflare account tokens into the public source; scheduled discovery needs only the app-specific signing secret.

## 4. Smoke checks

```sh
curl --fail https://YOUR_ACTUAL_HOST/api/health
curl --fail https://YOUR_ACTUAL_HOST/api/stats
curl --fail --get --data-urlencode 'q=meeting transcription and action items' https://YOUR_ACTUAL_HOST/api/search
```

Check a product detail URL directly without a logged-in session; the HTML must contain its escaped description and evidence. Verify missing pages return 404, arbitrary search pages send noindex, sitemap uses the deployed origin, and Turnstile accepts the correct hostname/action while invalid/replayed tokens fail. Submit one real app and inspect it through the protected CLI. Check logs for raw ideas/emails (none should be emitted).

Measure representative deployed Worker CPU and D1 rows read/written before opening traffic. Local benchmarks cannot certify the 10ms CPU limit. Watch account-wide quotas. If quotas are tight, reduce discovery batch size or disable it; no plan upgrade is necessary or automatic.

## External setup still required

Authorization is the only way to bind production resources. The initial Cloudflare connector read the account but later became unavailable; Wrangler reported not authenticated. No billing setting was changed. Domain ownership remains unconfirmed. Until credentials, a deployed hostname, the Turnstile widget, public repository settings, and operator policy details exist, production submissions/discovery must remain disabled.
