"""Bounded encrypted checkpoint transport for GitHub-hosted discovery runners."""
import argparse
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import zipfile
from .offline_discovery import PRIVATE_ROOT, private_path, save_private

NAME = 'catalog-expansion-state-v1'
JOURNAL = PRIVATE_ROOT / 'expansion' / 'journal.json'
ENCRYPTED = PRIVATE_ROOT / 'expansion' / 'expansion-state.enc'
MAX_BYTES = 16 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self):
        self.repository = os.environ['GITHUB_REPOSITORY']
        if self.repository != 'hmapinheiro6/therecouldbeanapp':
            raise ValueError('Cloud discovery is restricted to the configured public repository')
        self.token = os.environ['GITHUB_TOKEN']
        self.base = 'https://api.github.com/repos/' + self.repository

    def api(self, path, method='GET', body=None):
        if not path.startswith('/actions/') and path != '/contents/data/expansion-health.json':
            raise ValueError('Only Actions and the fixed public health file are allowed')
        request = urllib.request.Request(self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None, headers={
            'Authorization': 'Bearer ' + self.token,
            'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'ThereCouldBeAnApp-cloud-state'})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            data = response.read(2 * MAX_BYTES + 1)
        if len(data) > 2 * MAX_BYTES:
            raise ValueError('GitHub metadata exceeded bounded response size')
        return json.loads(data) if data else None

    def artifacts(self):
        body = self.api('/actions/artifacts?name=' + NAME + '&per_page=100')
        if body['total_count'] > 100:
            raise ValueError('Unexpected artifact backlog; refusing unbounded storage')
        return sorted([a for a in body['artifacts'] if a['name'] == NAME and not a['expired']],
                      key=lambda a: (datetime.fromisoformat(a['created_at'].replace('Z', '+00:00')), int(a['id'])), reverse=True)

    def download(self, artifact_id):
        url = self.base + '/actions/artifacts/' + str(int(artifact_id)) + '/zip'
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + self.token,
            'User-Agent': 'ThereCouldBeAnApp-cloud-state', 'Accept': 'application/vnd.github+json'})
        try:
            urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
            raise ValueError('Expected a signed artifact download redirect')
        except urllib.error.HTTPError as error:
            if error.code != 302:
                raise
            destination = error.headers.get('Location', '')
        target = urlsplit(destination)
        if target.scheme != 'https' or target.username or target.password or target.port or not (target.hostname or '').endswith('.blob.core.windows.net'):
            raise ValueError('Unexpected artifact download host')
        # No Authorization header is forwarded to the signed object-store URL.
        with urllib.request.build_opener(NoRedirect()).open(destination, timeout=30) as response:
            archive = response.read(MAX_BYTES + 65537)
        if len(archive) > MAX_BYTES + 65536:
            raise ValueError('Encrypted artifact exceeds bounded archive size')
        return unpack(archive)


def unpack(archive):
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        files = zipped.infolist()
        if len(files) != 1 or files[0].filename != 'expansion-state.enc' or files[0].file_size > MAX_BYTES:
            raise ValueError('Artifact must contain exactly one bounded encrypted state file')
        data = zipped.read(files[0])
        if len(data) > MAX_BYTES:
            raise ValueError('Encrypted state exceeds size limit')
        return data


def crypt(mode, source, target):
    if len(os.environ.get('INTERNAL_SECRET', '')) < 32:
        raise ValueError('Cloud checkpoint encryption key is missing')
    result = subprocess.run(['node', 'scripts/sealed-expansion-state.mjs', mode, str(source), str(target)],
                            capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Cloud checkpoint authentication/encryption failed; refusing to reset it')


def restore(github):
    directory = private_path(JOURNAL).parent
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    if os.environ.get('DURABLE_STATE_BRANCH') == 'true':
        import sys
        from .durable_state import restore_branch
        if restore_branch('expansion', sys.modules[__name__]):
            return
    artifacts = github.artifacts()
    if not artifacts:
        # Only bootstrap if this new workflow has never completed successfully.
        previous = github.api('/actions/workflows/expansion.yml/runs?status=success&per_page=1')
        if previous['total_count']:
            raise ValueError('Previously successful cloud checkpoint is missing; manual recovery required')
        print(json.dumps({'cloud_checkpoint': 'first_cloud_bootstrap', 'local_journal_used': False}))
        return
    latest = artifacts[0]
    run_id = int(latest['workflow_run']['id'])
    run = github.api('/actions/runs/' + str(run_id))
    if run['path'] != '.github/workflows/expansion.yml' or run['head_branch'] != 'main' or run['event'] not in ('schedule', 'workflow_dispatch'):
        raise ValueError('Checkpoint did not originate in the trusted cloud workflow')
    ENCRYPTED.write_bytes(github.download(latest['id']))
    os.chmod(ENCRYPTED, 0o600)
    temporary = JOURNAL.with_suffix('.restoring')
    try:
        crypt('open', ENCRYPTED, temporary)
        state = json.loads(temporary.read_text())
        if state.get('version') != 1 or state.get('cloud', {}).get('saved_run_id') != run_id or state['cloud'].get('repository') != github.repository:
            raise ValueError('Cloud checkpoint identity mismatch')
        save_private(JOURNAL, state)
    finally:
        temporary.unlink(missing_ok=True)
    # Keep the latest checkpoint until a new one is successfully uploaded.
    # At most one prior 16 MiB artifact survives into this run.
    for artifact in artifacts[1:]:
        github.api('/actions/artifacts/' + str(int(artifact['id'])), 'DELETE')
    print(json.dumps({'cloud_checkpoint': 'restored', 'previous_run_id': run_id,
                      'queued_records': len(state['records']), 'local_journal_used': False}))


def seal_state():
    state = json.loads(JOURNAL.read_text())
    state['runs'] = state.get('runs', [])[-12:]
    state['cloud'] = {'saved_run_id': int(os.environ['GITHUB_RUN_ID']),
                      'repository': os.environ['GITHUB_REPOSITORY'],
                      'saved_at': datetime.now(timezone.utc).isoformat()}
    save_private(JOURNAL, state)
    crypt('seal', JOURNAL, ENCRYPTED)
    if os.environ.get('DURABLE_STATE_BRANCH') == 'true':
        from .durable_state import StateBranch
        StateBranch('expansion').write(ENCRYPTED.read_bytes())
    output = os.environ.get('GITHUB_OUTPUT')
    if output:
        with Path(output).open('a') as handle:
            handle.write('ready=true\n')
    print(json.dumps({'cloud_checkpoint': 'encrypted', 'bytes': ENCRYPTED.stat().st_size,
                      'queued_records': len(state['records'])}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['restore', 'seal'])
    args = parser.parse_args()
    try:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise ValueError('Cloud transport runs only on GitHub Actions')
        if args.stage == 'restore':
            if len(os.environ.get('INTERNAL_SECRET', '')) < 32:
                raise ValueError('Cloud encryption key is missing')
            restore(GitHub())
        else:
            seal_state()
    except Exception as error:
        # Never print signed artifact URLs, token-bearing requests, or plaintext.
        print(json.dumps({'cloud_checkpoint': 'failed', 'failure_kind': type(error).__name__, 'reason': str(error)[:240] if type(error) is ValueError else None, 'http_status': error.code if isinstance(error, urllib.error.HTTPError) else None}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
