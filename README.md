# There Could Be An App

An evidence-backed software discovery engine, disguised as an 8-bit blueprint archive. React + TypeScript + Vite + Tailwind, a Hono Worker, Cloudflare D1 FTS5, and deterministic Python discovery. No AI inference, paid search, separate server, or paid datasets.

Live: [There Could Be An App](https://therecouldbeanapp.henriquepinheiro.workers.dev) · [Public repository](https://github.com/hmapinheiro6/therecouldbeanapp)

2,785 real published products, 39 categories, and 69 capability definitions as of 16 November 2026. 2,732 listings have checked official identities; 53 also have verified feature evidence (73 claims). [Catalog expansion and approval instructions](docs/CATALOG-EXPANSION.md).

Current availability: the account reached D1’s daily read quota on 16 November. Public browsing/search use a labelled saved catalog; sign-in/publishing await the 17 November 00:00 UTC reset. The inefficient export is corrected, and index maintenance is queued through existing cloud jobs. See the [incident and recovery report](docs/DATABASE-QUOTA-INCIDENT.md).

## Run it

Use Node 24 and Python 3.11+ (ingestion also tested on local Python 3.9).

```sh
npm ci
npm run build
npm run db:migrate
npm run db:seed
npm run dev:api
```

Open `http://localhost:8787`. For frontend hot reload, also run `npm run dev` and open `http://localhost:5173`; Vite proxies `/api` to the real local Worker.

Submissions and ingestion fail closed until configured. Copy `.env.example` to `.dev.vars`, supply distinct random secrets, and follow [deployment](docs/DEPLOYMENT.md). The application has no mock production endpoints. Seed records were fetched from official websites; rejected or inaccessible candidates are recorded separately.

## Checks

```sh
npm run lint
npm run typecheck
npm test
python3 -m venv .venv
.venv/bin/python -m pip install -r ingestion/requirements.txt
.venv/bin/python -m pytest tests/ingestion -q
npm run build
npx playwright install chromium
npm run test:e2e
npm run benchmark
```

The API suite uses actual local D1 in workerd. The search benchmark uses SQLite FTS5. E2E uses the real Worker, database, and frontend. Turnstile is replaced only within isolated API tests, never in production.

## Documentation

- [Engineering report and current deployment status](docs/REPORT.md)
- [Blueprint visual system and artwork](docs/DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Search design, measurements, and limitations](docs/SEARCH.md)
- [Full-catalog search checks and fixes](docs/FULL-CATALOG-SEARCH.md)
- [Private official-feature evidence audits](docs/OFFLINE-EVIDENCE-AUDIT.md)
- [Offline HN/GitHub SaaS discovery](docs/OFFLINE-DISCOVERY.md)
- [Autonomous hosted discovery and recovery](docs/AUTONOMOUS-DISCOVERY.md)
- [Import reservations and export query budgets](docs/INGESTION-BUDGET.md)
- [Work completed during the 16 November database block](docs/OUTAGE-WORK-2026-11-16.md)
- [Latest discovery results and simplified interface](docs/DISCOVERY-UPDATE.md)
- [Discovery and source permissions](docs/INGESTION.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Free-tier audit](docs/COSTS.md)
- [Deployment and external setup](docs/DEPLOYMENT.md)

Recent-launch discovery runs every six hours on free public GitHub runners. Licensed Homebrew backfill also runs every six hours; Awesome-Selfhosted refreshes daily. Official identities and capability verification are separate. The private `/admin/` dashboard supports review, direct approval, corrections, rejection, and unpublishing. Source code and sanitized published data are public; submission emails, review queues, access keys, and secrets remain private. See [catalog expansion](docs/CATALOG-EXPANSION.md) for observed runs, attribution, scheduling, and limits.
