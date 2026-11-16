# Operations

## Database changes

Create a numbered SQL file in `migrations/`, commit it, and run `npm run db:migrate` locally. Test against both an empty database and populated state. Wrangler tracks applied migrations; rerunning is safe. Apply remotely with `npx wrangler d1 migrations apply DB --remote` after local verification. Never rerun raw CREATE statements against production as a substitute for migration tracking.

## Private review dashboard

Use `/admin/` with the separate operator access key. Select a queued app, check its official source, edit identity or feature evidence, add a review note, confirm, and choose **Approve and publish**. **Published catalog** permits corrections and reversible unpublishing. Stable public slugs and canonical URL aliases protect existing links and deduplication. See [complete operator instructions](CATALOG-EXPANSION.md#approving-and-editing). The key and private screenshots are intentionally excluded from this repository.

## CLI review and moderation

Supply `INGESTION_API_URL` and `INTERNAL_SECRET` in your private environment. No secret argument is accepted by the CLI.

```sh
python3 -m ingestion.admin pending
python3 -m ingestion.admin pending --after LAST_RECORD_ID
python3 -m ingestion.admin approve submission UUID --reason 'Official site is ready for independent verification'
python3 -m ingestion.admin reject submission UUID --reason 'Not a usable software product'
python3 -m ingestion.admin retry candidate ID --reason 'Official website is now available'
python3 -m ingestion.admin remove product SLUG --reason 'Evidence no longer current'
```

The pending view contains private contact emails. Run it in a private terminal, not a public Actions log. Approval queues verification and never invents capability evidence. Product removal unpublishes immediately and triggers FTS deletion. A persistent `publication_blocks` row prevents rediscovery from republishing a removed canonical URL. To reinstate a product, inspect that block and its reason privately, remove the exact block through an authorized parameterized database operation, and reverify the candidate; a retry alone does not clear the block. The public manual moderation workflow supports record ID/action/reason; do not include private emails in workflow inputs because dispatch inputs can be visible to repository collaborators.

## Discovery failures and retry

Run `python3 -m ingestion.run --max-candidates 100`. Inspect `/api/health`, `/api/stats`, and the signed pending CLI for recent run statuses. A partial run does not advance source checkpoints. Previously persisted records are idempotent, so rediscovery is safe. Transient website failures retry after exponential day-level backoff; review failures need an operator retry. An interrupted runner can leave a stale running row; inspect its start time and the Actions job before treating it as healthy. A later successful run does not prove every candidate was publishable.

To stop new source work set the repository `DISCOVERY_ENABLED=false`. To stop the ingestion endpoint set `INGESTION_ENABLED=false` and redeploy. Preserve queues/checkpoints; do not discard evidence to make a run look successful.

## Scheduler inactivity

GitHub scheduled workflows can be delayed/dropped and are disabled after 60 days of repository inactivity in public repositories. Open Actions, select **Daily public product discovery**, choose **Enable workflow** if disabled, then **Run workflow**. Confirm D1's successful-run time advances. Maintenance is required; no keepalive commits or a personal machine are used to evade this rule.

## FTS rebuild and recovery

```sh
npm run db:rebuild
npx wrangler d1 execute DB --remote --file=scripts/rebuild-fts.sql
```

The index is derived from published canonical records and verified capability rows. These commands do not import virtual tables. For a sanitized portable backup:

```sh
python3 -m ingestion.admin snapshot --output /PRIVATE_PATH/published-catalog.json
python3 scripts/restore-snapshot.py /PRIVATE_PATH/published-catalog.json --output /tmp/catalog-restore.sql
```

Apply migrations to a **new** database, import the generated canonical SQL, then rebuild FTS. Rebind the Worker only after integrity checks and representative queries. Snapshots contain published facts and sources only, not submissions, private notes, rate identifiers, request signatures, or secrets. Snapshot restoration preserves primary source provenance and capability evidence; preserve the JSON snapshot for additional discovery-source provenance. Provider Time Travel is supplementary, not a substitute for a portable snapshot.

## Taxonomy and seeds

Update JSON taxonomy/alias files in `data/`. Vocabulary changes need migration/upsert into D1 before ingesting products that reference them. Reverify curated candidates with `python3 -m ingestion.seed`; it fetches official sites and emits public `catalog.json`, `catalog.sql`, and a verification report. Never replace real products with synthetic benchmark fixtures.

## Quotas, logs, retention

Read the Cloudflare Worker CPU/request and D1 read/write/storage dashboards. Search logs contain counts, wall time, and D1 retrieval rows read without raw query text. Never turn on URL logging without query redaction. Free-plan exhaustion must remain a service-unavailable event, never an automatic upgrade. API errors return controlled JSON without stack traces; platform CPU/resource failures may return Cloudflare responses.

Scheduled cleanup prunes expired request nonces and daily rate keys, removes old contact emails after 30 days, and deletes eligible closed submissions. Run discovery or an authenticated zero-candidate completed run to invoke cleanup after downtime. No privacy retention job can run if the cloud scheduler itself is disabled; monitor its last success.
