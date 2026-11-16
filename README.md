# There Could Be An App

An evidence-backed software discovery engine, disguised as an 8-bit blueprint archive. React + TypeScript + Vite + Tailwind, a Hono Worker, Cloudflare D1 FTS5, and deterministic Python discovery. No AI inference, paid search, separate server, or paid datasets.

Live: [There Could Be An App](https://therecouldbeanapp.henriquepinheiro.workers.dev) · [Public repository](https://github.com/hmapinheiro6/therecouldbeanapp)

52 published products, 37 categories, 39 capability definitions, and 72 verified product-capability claims as of 16 November 2026. [Final engineering report](docs/REPORT.md).

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
- [Latest discovery results and simplified interface](docs/DISCOVERY-UPDATE.md)
- [Discovery and source permissions](docs/INGESTION.md)
- [Operations and recovery](docs/OPERATIONS.md)
- [Free-tier audit](docs/COSTS.md)
- [Deployment and external setup](docs/DEPLOYMENT.md)

Daily discovery is scheduled at 04:17 UTC on standard public GitHub runners. It is enabled in the public repository, with the deployed API and signing secret configured. The latest cloud run processed 100 candidates; six new listings remain published after an evidence audit. See the discovery update for the raw run totals, held candidates, and coverage limits. Source code in that repository is public. Submission emails, private queues, and secrets stay in D1/provider secret storage and are never committed or uploaded as workflow artifacts.
