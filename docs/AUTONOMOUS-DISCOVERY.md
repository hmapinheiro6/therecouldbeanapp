# Autonomous cloud discovery

The production collector runs on GitHub-hosted Ubuntu runners, with GitHub's scheduler, ephemeral `GITHUB_TOKEN`, and existing repository secrets. It does not require a desktop agent, an open chat, a self-hosted runner, a local journal, or a personal access token on a laptop. Local research commands are optional editorial tools.

## Jobs

- **Autonomous web and SaaS discovery** (`cloud-discovery.yml`): every six hours, minute 23 UTC. Restores the previous encrypted cloud checkpoint, collects bounded HN/GitHub leads, checks official websites, and queues operator-review records in D1. New product features are never automatically approved by this collector.
- **Autonomous discovery watchdog** (`discovery-health.yml`): hourly, minute 41 UTC. A missing/stale successful cloud run triggers a new hosted collection unless one is already running/queued. A recent success without a recent durable checkpoint fails the watchdog. Once weekly, and when its outcome changes, it updates only the public `data/discovery-health.json` operational heartbeat, keeping repository activity independent of manual commits.
- **Process submissions and verification retries**: checks the existing private database queue and prepares operator-review drafts; it no longer duplicates the external HN/GitHub collector or publishes unapproved extracted features. Its quota pause does not stop independent cloud collection.
- Existing licensed directory backfills continue on their cloud schedules with the shared import budget.

The default cloud collector checks up to 80 official websites per run. It drains pending verification before advancing source cursors further, preventing a growing unchecked backlog. Each source cursor advances only with its matching saved leads. API-bound validation quarantines malformed records privately so one bad URL cannot block valid later deliveries. HN and GitHub source failures retain the affected cursor and remain visible failures; official-site restrictions become review holds without bypassing them. The GitHub search token is sent only to `api.github.com/search/repositories`, including across redirects; product websites never receive it.

## Database outages and durable state

Source collection and verification happen before database delivery. When D1 returns a typed daily limit, unsent public-source records stay in the cloud outbox, with the reset time saved to avoid repeated database probes. A future runner retries delivery automatically after that time. Successful D1 acknowledgement or a known/rejected/blocked remote identity is required before removing a record from the outbox. Interrupted deliveries can be replayed safely. No submissions, founder emails, sessions, access keys, or private D1 records are downloaded into this outbox.

The checkpoint is compressed and encrypted using Node's built-in AES-256-GCM. HKDF derives a separate state-encryption key from the existing signing secret, with a dedicated protocol context, random salt and fresh nonce. Authentication is checked before replacing plaintext state. Only the single ciphertext file `cloud-state.enc` is uploaded; plaintext journals remain temporary owner-only runner files. Wrong keys, malformed archives, untrusted workflow origins, oversized envelopes, or a missing previously successful checkpoint fail closed rather than silently resetting source cursors.

Encrypted state is capped at **1 MiB per artifact**. Restore retains the latest checkpoint while deleting older surplus copies; one prior and one newly uploaded checkpoint remain (up to about 2 MiB of ciphertext plus archive metadata). Retention is 90 days. Upload failure makes the run fail and preserves the previous remote checkpoint. A full encrypted outbox stops safely instead of creating unbounded artifact storage. These are project storage bounds, not an assertion about other repositories' account-wide usage. All jobs require the repository to remain public and use standard hosted runners.

## Scheduling and visibility

GitHub schedules can be delayed or dropped under load; the hourly watchdog provides a second schedule and can dispatch recovery itself. No local reminder or desktop automation is the scheduler. Job summaries distinguish collected work, database delivery, durable checkpoint upload, in-progress recovery and failures. A green handled database pause is not publication. The watchdog's public heartbeat contains only timestamps, outcome and the latest successful run URL.

GitHub documents [schedule behavior and the 60-day public-repository inactivity rule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). The weekly real health-file commit avoids relying on a person to keep the repository active. Its ephemeral `GITHUB_TOKEN` push [does not recursively trigger normal push workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow). Hosted public-runner usage is described in [GitHub billing](https://docs.github.com/en/actions/concepts/billing-and-usage).

After a secret rotation, a missing checkpoint, or a prolonged GitHub outage, investigate the explicit failure and preserve the last encrypted artifact before recovery. Operators can dispatch either workflow from GitHub; normal operation and watchdog recovery require no such action. Existing private review/approval remains an editorial step, accessible through `/admin/` after D1 recovers.

Implementation tests exercise two-run checkpoint restoration, authenticated encryption/wrong-key rejection, bounded artifacts, untrusted archive paths, source-token redirect isolation, database outage collection, idempotent outbox delivery, and watchdog recovery/weekly heartbeat behavior. Hosted execution and checkpoint-resumption evidence is recorded after the first cloud verification runs.
