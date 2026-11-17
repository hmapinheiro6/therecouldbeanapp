import base64
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from unittest.mock import Mock
import pytest
from ingestion import backup,query_usage
from ingestion.durable_state import StateBranch

SECRET='isolated-backup-key-for-tests-at-least-32-characters'

def encrypted_state(tmp_path,kind):
    source=tmp_path/(kind+'.json');cipher=tmp_path/(kind+'.enc')
    source.write_text(json.dumps({'version':1,'records':[{'private_contact':'private@example.invalid'}]}))
    script='scripts/sealed-'+kind+'-state.mjs'
    result=subprocess.run(['node',script,'seal',str(source),str(cipher)],capture_output=True,env={**os.environ,'INTERNAL_SECRET':SECRET})
    assert result.returncode==0
    return cipher.read_bytes()

def test_full_backup_authenticates_and_restores_private_tables_and_collectors(tmp_path,monkeypatch):
    monkeypatch.setenv('INTERNAL_SECRET',SECRET)
    db=sqlite3.connect(':memory:')
    for migration in sorted(Path('migrations').glob('*.sql')):db.executescript(migration.read_text())
    db.execute("INSERT INTO submissions(id,product_name,submitted_url,description,contact_email) VALUES('private','Private fixture','https://fixture.invalid','Private review fixture','private@example.invalid')")
    sql='\n'.join(db.iterdump());db.close()
    states={k:base64.b64encode(encrypted_state(tmp_path,k)).decode() for k in ('cloud','expansion')}
    payload={'version':1,'database':'therecouldbeanapp-catalog','sql':sql,'states':states}
    plain=tmp_path/'full.json';sealed=tmp_path/'full.enc';restored=tmp_path/'full-restored.json'
    plain.write_text(json.dumps(payload));backup.crypt('seal',plain,sealed)
    assert b'private@example.invalid' not in sealed.read_bytes()
    backup.crypt('open',sealed,restored)
    directory=tmp_path/'new';directory.mkdir()
    proof=backup.verify_payload(json.loads(restored.read_text()),directory)
    assert proof['integrity']=='ok' and proof['table_counts']['submissions']==1
    assert proof['restored_collector_records']=={'cloud':1,'expansion':1}
    original=restored.read_bytes();monkeypatch.setenv('INTERNAL_SECRET','different-key-at-least-32-characters-for-test')
    with pytest.raises(RuntimeError):backup.crypt('open',sealed,restored)
    assert restored.read_bytes()==original

def test_dedicated_state_branch_never_publishes_plaintext_or_rewrites_main(tmp_path,monkeypatch):
    monkeypatch.setenv('GITHUB_REPOSITORY','hmapinheiro6/therecouldbeanapp');monkeypatch.setenv('GITHUB_TOKEN','fixture-token');monkeypatch.setenv('GITHUB_RUN_ID','123')
    store=StateBranch('cloud');store.current=Mock(return_value=({'object':{'sha':'a'*40}},{'checkpoint.enc':{'sha':'b'*40}}))
    store.api=Mock(side_effect=[{'sha':'c'*40},{'sha':'d'*40},{'sha':'e'*40},None])
    with pytest.raises(ValueError):store.write(b'{"private_contact":"private@example.invalid"}')
    store.write(encrypted_state(tmp_path,'cloud'))
    assert store.api.call_args.args[0]=='/git/refs/heads/state/cloud-discovery'
    assert store.api.call_args.args[2]['force'] is True
    tree=store.api.call_args_list[1].args[2]['tree']
    assert {x['path'] for x in tree}=={'checkpoint.enc','previous.enc','provenance.json'}
    assert store.api.call_args_list[2].args[2]['parents']==[]
    assert 'private@example.invalid' not in str(store.api.call_args_list)

def test_job_fails_when_provider_read_totals_exceed_its_budget(tmp_path,monkeypatch):
    (tmp_path/'data').mkdir();(tmp_path/'data/job-budgets.json').write_text('{"default":10}')
    monkeypatch.setattr(query_usage,'ROOT',tmp_path);monkeypatch.setenv('GITHUB_ACTIONS','true');monkeypatch.setenv('GITHUB_RUN_ID','123')
    query_usage.record({'X-D1-Rows-Read':'6','X-D1-Rows-Written':'2'})
    with pytest.raises(RuntimeError,match='exceeded'):query_usage.record({'X-D1-Rows-Read':'5','X-D1-Rows-Written':'0'})
    with pytest.raises(ValueError,match='missing'):query_usage.record({})
