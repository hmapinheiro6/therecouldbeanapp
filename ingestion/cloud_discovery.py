"""Machine-independent public-source collection with a private cloud review outbox."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from . import offline_discovery as offline
from .client import InternalClient, InternalAPIError
from .cloud_artifacts import JOURNAL
from .extraction import ROOT, now
from .run import queue_record
from .safe_web import SafeWeb
from .sources import Sources
from .workflow import reset_time


def plain(value, length):
    text = re.sub(r'[<>\x00-\x08\x0b-\x1f]', '', str(value))
    return text.encode('utf-16-le')[:length*2].decode('utf-16-le', errors='ignore')


def review_record(record):
    candidate = dict(record['candidate'])
    for key, maximum in [('canonical_url', 2000), ('source_url', 2000), ('source_name', 100), ('external_id', 200)]:
        value = candidate.get(key)
        if not isinstance(value, str) or not value or len(value.encode('utf-16-le'))//2 > maximum:
            raise ValueError('Invalid cloud queue field: ' + key)
    candidate['name'] = plain(candidate['name'], 100) or 'Unnamed product'
    reason = 'Official web identity checked; operator review required.' if record['status'] == 'draft' else record.get('reason', 'Official identity needs review.')
    payload = queue_record(candidate, 'needs_review', plain(reason, 500))
    if record['status'] == 'draft':
        product = record['draft']['product']
        if product['verification_scope'] != 'identity' or product['capabilities']:
            raise ValueError('Cloud discovery may queue identity-only drafts, never approve features')
        encoded = json.dumps(product, separators=(',', ':'))
        if len(encoded) > 12000:
            raise ValueError('Cloud review draft exceeds API limit')
        payload['review_draft_json'] = encoded
    return payload


def deliver(state, persist, limit=100, client_factory=InternalClient):
    delivery = state.setdefault('delivery', {})
    reset = reset_time(delivery.get('retry_at'))
    if reset and datetime.fromisoformat(reset.replace('Z', '+00:00')) > datetime.now(timezone.utc):
        return {'outcome': 'deferred', 'reason': 'saved_daily_limit', 'reset_at': reset, 'queued_to_d1': 0}
    sent = 0
    try:
        client = client_factory()
        ready = client.request('/api/internal/maintenance', {})
        if ready.get('status') != 'ready':
            raise ValueError('Unexpected cloud maintenance response')
        delivery.pop('retry_at', None)
        pending = []
        payloads = {}
        for record in [r for r in state['records'] if r['status'] in ('draft', 'held')][:limit]:
            try:
                payloads[record['id']] = review_record(record)
                pending.append(record)
            except (ValueError, KeyError, TypeError) as error:
                # Invalid public-source records cannot poison all later delivery.
                # Preserve them privately for inspection; never drop valid records
                # or label a quarantined item published/acknowledged.
                state.setdefault('quarantined', []).append({'record': record, 'reason': str(error)[:160], 'quarantined_at': now()})
                state['records'].remove(record)
                persist(state)
        for start in range(0, len(pending), 30):
            batch = pending[start:start + 30]
            known = set(client.request('/api/internal/known', {'urls': [payloads[r['id']]['canonical_url'] for r in batch]})['known'])
            for record in batch:
                canonical = payloads[record['id']]['canonical_url']
                if canonical not in known:
                    result = client.request('/api/internal/ingest', {'candidates': [payloads[record['id']]]})
                    if result.get('status') != 'accepted':
                        raise ValueError('Review queue write was not acknowledged')
                    sent += 1
                # Remote writes are idempotent; remove only after acknowledgement
                # or a remote known/blocked result, and persist after each record.
                state['records'].remove(record)
                delivery['total_queued_to_d1'] = delivery.get('total_queued_to_d1', 0) + (canonical not in known)
                persist(state)
        return {'outcome': 'delivered', 'queued_to_d1': sent}
    except InternalAPIError as error:
        if (error.status, error.code) not in ((503, 'database_daily_limit'), (429, 'ingestion_daily_budget')):
            raise
        delivery['retry_at'] = reset_time(error.reset_at)
        persist(state)
        return {'outcome': 'deferred', 'reason': error.code, 'reset_at': delivery['retry_at'], 'queued_to_d1': sent}


def run(max_candidates=100, max_verify=80, windows=3, workers=6, verify_only=False):
    if not 1 <= max_candidates <= 200 or not 0 <= max_verify <= 80 or not 1 <= windows <= 7 or not 1 <= workers <= 8:
        raise ValueError('Cloud collection bounds exceeded')
    snapshot = json.loads((ROOT / 'data/seeds/published-snapshot.json').read_text())
    persist = lambda value: offline.save_private(JOURNAL, value)
    with offline.journal_lock(JOURNAL):
        state = json.loads(JOURNAL.read_text()) if JOURNAL.exists() else offline.new_state(2)
        if state.get('version') != 1:
            raise ValueError('Unsupported cloud journal')
        current = {'started_at': now(), 'execution': 'github-hosted', 'github_run_id': os.environ.get('GITHUB_RUN_ID')}
        state['runs'].append(current)
        state['runs'] = state['runs'][-12:]
        persist(state)
        source = Sources(SafeWeb(delay=2, github_token=os.environ.get('GITHUB_TOKEN')))
        # Drain unverified leads before advancing source cursors further. The
        # bounded outbox must not grow faster than official verification.
        pending_count = sum(r['status'] == 'pending' for r in state['records'])
        collection_limit = min(max_candidates, max(0, max_verify - pending_count)) if max_verify else 0
        current['collection'] = None if verify_only or not collection_limit else offline.collect(state, snapshot, source, collection_limit, windows, persist)
        current['checked_this_run'] = offline.verify_pending(state, snapshot, max_verify, workers, persist)
        current['drafts_reaudited'] = offline.audit_saved_drafts(state)
        before = offline.summary(state)
        current['delivery'] = deliver(state, persist)
        current['quarantined_records'] = len(state.get('quarantined', []))
        current.update(completed_at=now(), before_delivery=before, remaining_cloud_queue=offline.summary(state))
        errors = current['collection']['source_errors'] if current['collection'] else []
        current['outcome'] = 'partial_source_failure' if errors else 'collected'
        persist(state)
        print(json.dumps(current, indent=2))
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with Path(summary).open('a') as handle:
                handle.write('\n## Autonomous discovery — ' + current['outcome'].upper() + '\n\n')
                handle.write('Executed on GitHub-hosted infrastructure. No local agent, desktop session or local journal was used.\n\n')
                found = current['collection']['new_candidates'] if current['collection'] else 0
                handle.write(f'New source leads: **{found}**. Official sites checked: **{current["checked_this_run"]}**. Review records queued in D1: **{current["delivery"]["queued_to_d1"]}**. Published by this collector: **0**.\n\n')
                handle.write('Database delivery: **' + current['delivery']['outcome'].upper() + '**. Remaining encrypted cloud records: **' + str(len(state['records'])) + '**. A deferred database delivery does not stop collection.\n\n')
                handle.write('Invalid records quarantined privately for inspection: **' + str(current['quarantined_records']) + '**.\n\n')
                handle.write('The encrypted checkpoint must be uploaded successfully before this run is considered durable. Identity and feature approval remain separate editorial decisions.\n')
        return 1 if errors else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-candidates', type=int, default=100)
    parser.add_argument('--max-verify', type=int, default=80)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise ValueError('Use the hosted GitHub workflow for cloud collection')
        raise SystemExit(run(args.max_candidates, args.max_verify, verify_only=args.verify_only))
    except Exception as error:
        print(json.dumps({'cloud_collection': 'failed', 'failure_kind': type(error).__name__}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
