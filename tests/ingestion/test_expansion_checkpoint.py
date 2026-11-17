import json,os,subprocess
from pathlib import Path
from ingestion import expansion_artifacts as transport


def test_campaign_checkpoint_has_distinct_encryption_context_and_requires_its_workflow(tmp_path):
    source=tmp_path/'source';sealed=tmp_path/'encrypted';opened=tmp_path/'opened'
    source.write_text(json.dumps({'version':1,'records':[{'private_review':'unpublished candidate'}]}))
    env={**os.environ,'INTERNAL_SECRET':'isolated-test-key-at-least-32-characters'}
    def run(script,mode,out): return subprocess.run(['node',script,mode,str(source if mode=='seal' else sealed),str(out)],env=env,capture_output=True)
    assert run('scripts/sealed-expansion-state.mjs','seal',sealed).returncode==0
    assert b'unpublished candidate' not in sealed.read_bytes()
    assert run('scripts/sealed-cloud-state.mjs','open',opened).returncode!=0
    assert run('scripts/sealed-expansion-state.mjs','open',opened).returncode==0
    assert opened.read_bytes()==source.read_bytes()
    assert transport.NAME=='catalog-expansion-state-v1'
    assert transport.JOURNAL.parent.name=='expansion'
