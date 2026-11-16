# GitHub workflow investigation — 16 November 2026

Read all 22 recorded Actions runs at about 14:29 UTC through the connected GitHub API, then inspected logs for all five failures and the latest successful imports. No job was rerun, no collector was dispatched, and no production D1 request was made.

| Workflow | Success | Failure | Skipped | Latest run at inspection |
| --- | ---: | ---: | ---: | --- |
| CI | 12 | 1 | 1 | [Passed](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43883504736) |
| Daily public product discovery | 2 | 2 | 0 | [Passed](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43835259508) |
| Build the verified software catalog | 2 | 2 | 0 | [Passed](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43844794785) |

## What the five failures actually were

| Run | Logged failure | Resolution already present before this investigation |
| --- | --- | --- |
| [15 Nov 20:38 discovery](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43759227987) | Internal API HTTP 403 | Signed client received an explicit ingestion User-Agent and redirect protection in `8de7eba`; later imports succeeded. The original log alone does not identify which upstream rule produced the 403. |
| [15 Nov 20:40 discovery](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43759436209) | HN network/TLS failure | Public IPv4 preference on cloud runners in `72459b9`; the following discovery run passed. |
| [16 Nov 09:43 backfill](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43842290981) | `ModuleNotFoundError: No module named 'ingestion'` | Changed execution to `python -m ingestion.backfill` in `e462e5c`. |
| [16 Nov 09:48 backfill](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43843003636) | `TypeError: sequence item 1: expected str instance, NoneType found` | Missing metadata normalized to empty strings and malformed pages isolated in `0f0e147`; both subsequent backfills passed. |
| [16 Nov 14:12 CI](https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/43883375206) | Missing `data/full-catalog-search.json` caused type-check errors | The fixture was omitted from the first commit. `36bad14` added it; the following CI run passed every step. |

These are historical development failures, not evidence that the latest revisions are constantly failing. Every failure has a later successful run of the same workflow. All eight discovery/backfill runs in this history were manually dispatched; none was a `schedule` event. Their configured schedules therefore have not yet been demonstrated by this history. A passed build does not prove the database is currently available.

The latest cloud discovery processed 100 candidates and recorded nine accepted, 91 pending, no source error. Successful Homebrew and self-hosted jobs recorded 1,599 and 1,052 accepted records respectively. Those are accepted batch records, not necessarily disjoint new products. They are separate from the local 412-lead research batch.

## Reporting improvement made now

Both import workflows now call `python -m ingestion.workflow prepare`, then start collection only when the signed maintenance response explicitly reports ready. A typed `database_daily_limit` (503) or `ingestion_daily_budget` (429) produces an explicit **DEFERRED** job summary and annotation, preserves the reset time, and stops immediate retries. A preparation pause skips source collection entirely. A limit during an import warns that earlier batches may already have committed and is never called a completed collection.

GitHub can show a green job for a deliberately handled pause; the job summary and `outcome=deferred` output are the authoritative outcome. This is not a claim of successful publication or recovery. Authentication failures, unknown 503s, wrong status/code combinations, malformed configuration, and partial source failures remain nonzero failures. There is no blanket `continue-on-error`, no authentication bypass, and no new D1 access to test the outage. A failure while saving a backfill's final status no longer replaces the original failure.

The reporting uses GitHub's documented [step outputs, notices and job summaries](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands). Seventeen focused regressions and all **125 Python tests** pass, including simulated blocked preparation, mid-import budgets, failed authentication, preserved failure codes, and no source work after a deferred preparation. Live blocked preparation has deliberately not been retried against D1.

## Where the 412 leads came from

They came from **local agent-run automation** on 16 November, using the existing `Sources.hackernews` and `Sources.github` adapters through `ingestion.offline_discovery`: **180 HN leads and 232 GitHub leads**. GitHub is a source of product leads here; GitHub Actions was not the execution environment. The local journal records collection at 14:01–14:05 UTC, with private re-audits afterward. Every lead retains its original HN item or GitHub repository URL and canonical product website.

The local pass used a 30-day initial lookback, collected 420 candidates and removed eight duplicates against the public snapshot/local journal. It checked 300 official sites, retained 14 identity-only review drafts, held 286, and left 112 unchecked. These are not 412 verified apps or publications. The inaccessible private D1 queue still needs a final duplicate check after recovery. See the private `.ingestion-state/offline-discovery.json` journal and the [offline discovery instructions](OFFLINE-DISCOVERY.md).
