# There Could Be An App

An evidence-backed software discovery engine, disguised as an 8-bit blueprint archive. React + TypeScript + Vite + Tailwind, a Hono Worker, Cloudflare D1 FTS5, and deterministic Python discovery. No AI inference, paid search, separate server, or paid datasets.

Live: [There Could Be An App](https://therecouldbeanapp.henriquepinheiro.workers.dev) · [Public repository](https://github.com/hmapinheiro6/therecouldbeanapp)

The live API reported **2,865 published products at 08:40 UTC on 17 November 2026**. The saved public recovery snapshot has 2,785 products, 39 categories and 69 capability definitions, including 53 products with 73 documented feature claims as of 16 November. Live feature-scope totals were not re-counted during this status check. [Catalog expansion and approval instructions](docs/CATALOG-EXPANSION.md).

Current availability: D1 recovered after the 16 November read-quota incident. On 17 November, hosted jobs completed maintenance, delivered review records and published 80 additional listings; the live stats API returned HTTP 200. Admin sign-in was not manually re-tested in this status check. The 00:45 alert does not by itself establish a new daily block. See the [incident and recovery report](docs/DATABASE-QUOTA-INCIDENT.md) and [database/hosting assessment](docs/PLATFORM-REVIEW-2026-11-17.md).

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
.venv/bin/python -m pip install -r ingestion/requirements.txt -r ingestion/preview-requirements.txt
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
- [Lean publisher images and autonomous metadata collection](docs/METADATA-PREVIEWS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Search design, measurements, and limitations](docs/SEARCH.md)
- [Full-catalog search checks and fixes](docs/FULL-CATALOG-SEARCH.md)
- [Private official-feature evidence audits](docs/OFFLINE-EVIDENCE-AUDIT.md)
- [Offline HN/GitHub SaaS discovery](docs/OFFLINE-DISCOVERY.md)
- [Autonomous hosted discovery and recovery](docs/AUTONOMOUS-DISCOVERY.md)
- [Import reservations and export query budgets](docs/INGESTION-BUDGET.md)
- [Measured catalog growth constraints and proposed ramp](docs/CATALOG-GROWTH.md)
- [Work completed during the 16 November database block](docs/OUTAGE-WORK-2026-11-16.md)
- [Latest discovery results and simplified interface](docs/DISCOVERY-UPDATE.md)
- [Discovery and source permissions](docs/INGESTION.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Free-tier audit](docs/COSTS.md)
- [Deployment and external setup](docs/DEPLOYMENT.md)

Recent-launch discovery runs every six hours on free public GitHub runners. Licensed Homebrew backfill also runs every six hours; Awesome-Selfhosted refreshes daily. Official identities and capability verification are separate. The private `/admin/` dashboard supports review, direct approval, corrections, rejection, and unpublishing. Source code and sanitized published data are public; submission emails, review queues, access keys, and secrets remain private. See [catalog expansion](docs/CATALOG-EXPANSION.md) for observed runs, attribution, scheduling, and limits.
