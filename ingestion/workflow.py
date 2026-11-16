"""Explicit ready/completed/deferred/failed outcomes for cloud ingestion jobs.

Only the API's two typed quota responses can defer work. Auth, configuration,
unexpected HTTP failures and partial source runs keep a nonzero exit status.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from .client import InternalClient, InternalAPIError


def reset_time(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except (ValueError, AttributeError, TypeError):
        return None


def report(stage, outcome, code=None, reset=None, kind=None, status=None):
    payload = {'stage': stage, 'outcome': outcome}
    if code:
        payload['code'] = code
    if reset:
        payload['reset_at'] = reset
    if kind:
        payload['failure_kind'] = kind
    if status:
        payload['http_status'] = status
    print(json.dumps(payload))
    output = os.environ.get('GITHUB_OUTPUT')
    if output:
        with Path(output).open('a') as stream:
            stream.write('ready=' + str(outcome == 'ready').lower() + '\n')
            stream.write('outcome=' + outcome + '\n')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with Path(summary).open('a') as stream:
            stream.write('\n### Catalog ' + stage + ': ' + outcome.upper() + '\n\n')
            if outcome == 'deferred':
                stream.write('Expected daily allowance pause (`' + code + '`). This is **not a completed collection or publication**.\n\n')
                stream.write('Reset: ' + (reset or 'see the private API response / next UTC day') + '. No immediate retry.\n\n')
                stream.write('Preparation stops before source work. If an import was already running, earlier batches may have committed; inspect its persisted run before resuming. Existing records are retained.\n')
            elif outcome == 'ready':
                stream.write('Signed database maintenance succeeded. Source work may proceed.\n')
            elif outcome == 'completed':
                stream.write('The requested import completed. Counts are in its run output. This does not imply that all discovered candidates were published.\n')
            else:
                stream.write('The workflow failed; investigate the failing step. It was not converted into a quota pause.\n')
    if outcome == 'deferred':
        print('::notice title=Catalog import deferred::Daily allowance pause; see the job summary. No completed import is claimed.')


def execute(stage, max_candidates=100, workers=8, source='homebrew', queue_only=False):
    try:
        if stage == 'prepare':
            result = InternalClient().request('/api/internal/maintenance', {})
            if not isinstance(result, dict) or result.get('status') != 'ready':
                raise RuntimeError('Unexpected maintenance response')
            report(stage, 'ready')
            return 0
        if stage == 'discover':
            from .run import run
            result = run(False, max_candidates, queue_only=True) if queue_only else run(False, max_candidates)
            if result:
                report(stage, 'failed', kind='PartialSourceFailure')
                return 1
        else:
            from .backfill import run
            run(max_candidates, workers, False, source)
        report(stage, 'completed')
        return 0
    except InternalAPIError as error:
        expected = (error.status, error.code) in (
            (503, 'database_daily_limit'), (429, 'ingestion_daily_budget'))
        if expected:
            report(stage, 'deferred', code=error.code, reset=reset_time(error.reset_at))
            return 0
        report(stage, 'failed', kind='InternalAPIError', status=error.status)
        return 1
    except Exception as error:
        # No raw exception text: configuration values and pending records are private.
        report(stage, 'failed', kind=type(error).__name__)
        return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'discover', 'backfill'])
    parser.add_argument('--max-candidates', type=int, default=100)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--queue-only', action='store_true')
    parser.add_argument('--source', choices=['homebrew', 'selfhosted'], default='homebrew')
    args = parser.parse_args()
    if not 1 <= args.max_candidates <= (100 if args.stage == 'discover' else 2000) or not 1 <= args.workers <= 12:
        parser.error('Use 1–100 discovery / 1–2000 backfill candidates and 1–12 workers')
    raise SystemExit(execute(args.stage, args.max_candidates, args.workers, args.source, args.queue_only))


if __name__ == '__main__':
    main()
