"""Nonexpiring encrypted checkpoints on isolated, bounded Git state branches.

The branch contains only current and previous ciphertext and public provenance.
Each replacement has no parents, so checkpoint history cannot grow without bound.
Main is never modified. Existing Actions artifacts are read only for first migration.
"""
import base64
from datetime import datetime, timezone
import json
import os
import urllib.error
import urllib.request
from .client import NoRedirect

REPOSITORY = 'hmapinheiro6/therecouldbeanapp'
BRANCHES = {'cloud': 'state/cloud-discovery', 'expansion': 'state/catalog-expansion'}
MAX_BYTES = {'cloud': 1024 * 1024, 'expansion': 16 * 1024 * 1024}

class StateBranch:
    def __init__(self, kind):
        if kind not in BRANCHES or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
            raise ValueError('Untrusted checkpoint repository or kind')
        self.kind, self.branch = kind, BRANCHES[kind]
        self.token = os.environ['GITHUB_TOKEN']

    def api(self, path, method='GET', value=None):
        if not path.startswith(('/git/', '/actions/runs/')):
            raise ValueError('Checkpoint API path is not allowed')
        request = urllib.request.Request('https://api.github.com/repos/'+REPOSITORY+path,
            method=method, data=json.dumps(value).encode() if value is not None else None,
            headers={'Authorization':'Bearer '+self.token, 'User-Agent':'tcba-durable-state',
                     'Accept':'application/vnd.github+json', 'Content-Type':'application/json'})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
            data=response.read(MAX_BYTES[self.kind]*2+1048577)
        if len(data)>MAX_BYTES[self.kind]*2+1048576:
            raise ValueError('Checkpoint API response too large')
        return json.loads(data) if data else None

    def current(self):
        try:
            ref=self.api('/git/ref/heads/'+self.branch)
        except urllib.error.HTTPError as error:
            if error.code==404:return None
            raise
        commit=self.api('/git/commits/'+ref['object']['sha'])
        tree=self.api('/git/trees/'+commit['tree']['sha'])
        entries={e['path']:e for e in tree['tree']}
        if tree.get('truncated') or set(entries)-{'checkpoint.enc','previous.enc','provenance.json'} or not {'checkpoint.enc','provenance.json'} <= set(entries):
            raise ValueError('Unexpected durable state branch contents')
        return ref,entries

    def read(self):
        current=self.current()
        if current is None:return None
        _,entries=current
        entry=entries['checkpoint.enc']
        if entry.get('size',MAX_BYTES[self.kind]+1)>MAX_BYTES[self.kind]:
            raise ValueError('Durable ciphertext too large')
        blob=self.api('/git/blobs/'+entry['sha'])
        data=base64.b64decode(blob['content'])
        if len(data)>MAX_BYTES[self.kind]:raise ValueError('Durable ciphertext too large')
        return data

    def write(self, data, saved_at=None):
        if not data or len(data)>MAX_BYTES[self.kind]:raise ValueError('Invalid encrypted checkpoint size')
        # Accept authenticated-encryption envelopes only, never journal JSON.
        envelope=json.loads(data)
        if envelope.get('version')!=1 or set(envelope)!={'version','salt','iv','tag','data'}:
            raise ValueError('Refusing to publish plaintext state')
        previous=self.current()
        blob=self.api('/git/blobs','POST',{'content':base64.b64encode(data).decode(),'encoding':'base64'})
        provenance={'version':1,'kind':self.kind,'saved_at':saved_at or datetime.now(timezone.utc).isoformat(),
                    'run_id':int(os.environ['GITHUB_RUN_ID']),'repository':REPOSITORY}
        tree=[{'path':'checkpoint.enc','mode':'100644','type':'blob','sha':blob['sha']},
              {'path':'provenance.json','mode':'100644','type':'blob','content':json.dumps(provenance)}]
        if previous:tree.append({'path':'previous.enc','mode':'100644','type':'blob','sha':previous[1]['checkpoint.enc']['sha']})
        tree_sha=self.api('/git/trees','POST',{'tree':tree})['sha']
        commit=self.api('/git/commits','POST',{'message':'Save encrypted '+self.kind+' checkpoint','tree':tree_sha,'parents':[]})['sha']
        if previous:self.api('/git/refs/heads/'+self.branch,'PATCH',{'sha':commit,'force':True})
        else:self.api('/git/refs','POST',{'ref':'refs/heads/'+self.branch,'sha':commit})
        print(json.dumps({'durable_checkpoint':'saved','branch':self.branch,'bytes':len(data)}))


def restore_branch(kind, module):
    store=StateBranch(kind)
    cipher=store.read()
    if cipher is None:return False
    module.ENCRYPTED.write_bytes(cipher)
    os.chmod(module.ENCRYPTED,0o600)
    temporary=module.JOURNAL.with_suffix('.restoring')
    try:
        module.crypt('open',module.ENCRYPTED,temporary)
        state=json.loads(temporary.read_text())
        cloud=state.get('cloud',{})
        run=store.api('/actions/runs/'+str(int(cloud['saved_run_id'])))
        workflow='.github/workflows/'+('cloud-discovery' if kind=='cloud' else 'expansion')+'.yml'
        if state.get('version')!=1 or cloud.get('repository')!=REPOSITORY or run['path']!=workflow or run['head_branch']!='main' or run['event'] not in ('workflow_dispatch','schedule'):
            raise ValueError('Durable checkpoint provenance mismatch')
        module.save_private(module.JOURNAL,state)
    finally:temporary.unlink(missing_ok=True)
    print(json.dumps({'durable_checkpoint':'restored','branch':store.branch,'queued_records':len(state['records'])}))
    return True
