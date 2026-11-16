"""Hosted watchdog, missed-run recovery, and weekly public repository heartbeat."""
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import urllib.error
from .cloud_artifacts import GitHub

WORKFLOW = '/actions/workflows/cloud-discovery.yml'
HEALTH_FILE = '/contents/data/discovery-health.json'


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def check(github, clock=None):
    clock = clock or datetime.now(timezone.utc)
    runs = github.api(WORKFLOW + '/runs?branch=main&per_page=20')['workflow_runs']
    active = any(r['status'] in ('queued', 'in_progress', 'waiting', 'requested', 'pending') for r in runs)
    successful = next((r for r in runs if r['conclusion'] == 'success'), None)
    recent = successful and clock - timestamp(successful['updated_at']) < timedelta(hours=8)
    outcome = 'healthy' if recent else 'in_progress' if active else 'recovery_dispatched'
    if recent:
        artifacts = github.artifacts()
        if not artifacts or clock - timestamp(artifacts[0]['created_at']) >= timedelta(hours=8):
            raise ValueError('Cloud run succeeded but its durable checkpoint is missing or stale')
    elif not active:
        # GitHub explicitly allows workflow_dispatch with its ephemeral token.
        github.api(WORKFLOW + '/dispatches', 'POST', {'ref': 'main'})
    report = {'checked_at': clock.isoformat(), 'outcome': outcome,
              'latest_success_at': successful['updated_at'] if successful else None,
              'latest_success_url': successful['html_url'] if successful else None}
    try:
        existing = github.api(HEALTH_FILE)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        existing = None
    previous = json.loads(base64.b64decode(existing['content'])) if existing else None
    # A small real repository update once weekly avoids relying on a person to
    # keep a public scheduled-workflow repository active within GitHub's 60 days.
    if not previous or previous.get('outcome') != outcome or clock - timestamp(previous['checked_at']) >= timedelta(days=7):
        body = {'message': 'Update autonomous discovery health', 'branch': 'main',
                'content': base64.b64encode((json.dumps(report, indent=2) + '\n').encode()).decode()}
        if existing:
            body['sha'] = existing['sha']
        github.api(HEALTH_FILE, 'PUT', body)
    return report


def main():
    try:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise ValueError('Use the hosted watchdog workflow')
        report = check(GitHub())
        print(json.dumps(report))
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with Path(summary).open('a') as stream:
                stream.write('\n## Autonomous discovery watchdog: ' + report['outcome'].upper() + '\n\n')
                stream.write('Latest successful hosted collection: ' + str(report['latest_success_url']) + '\n\n')
                stream.write('Recovery dispatch means a new cloud run was requested, not that it has already completed. No local machine or desktop automation is used.\n')
    except Exception as error:
        print(json.dumps({'cloud_health': 'failed', 'kind': type(error).__name__}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
