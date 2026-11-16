import copy
import io
import json
import os
from pathlib import Path
import subprocess
import zipfile
from unittest.mock import Mock, patch
import pytest
from ingestion import cloud_artifacts as artifacts
from ingestion import offline_discovery as offline

SECRET='isolated-cloud-encryption-test-at-least-32-characters'

def crypt(mode, source, target, secret=SECRET):
    return subprocess.run(['node','scripts/sealed-cloud-state.mjs',mode,str(source),str(target)],capture_output=True,text=True,env={**os.environ,'INTERNAL_SECRET':secret})

def test_encrypted_checkpoint_roundtrip_and_wrong_key_preserve_previous_file(tmp_path):
    source=tmp_path/'journal.json';cipher=tmp_path/'cloud-state.enc';restored=tmp_path/'restored.json'
    source.write_text(json.dumps({'private_unpublished_product':'Example secret review','version':1}))
    assert crypt('seal',source,cipher).returncode==0
    assert b'Example secret review' not in cipher.read_bytes()
    assert crypt('open',cipher,restored).returncode==0
    assert restored.read_bytes()==source.read_bytes()
    original=restored.read_bytes()
    assert crypt('open',cipher,restored,secret='different-private-key-long-enough-32-characters').returncode!=0
    assert restored.read_bytes()==original
    envelope=json.loads(cipher.read_text());data=bytearray(__import__('base64').b64decode(envelope['data']));data[0]^=1
    envelope['data']=__import__('base64').b64encode(data).decode();cipher.write_text(json.dumps(envelope))
    assert crypt('open',cipher,restored).returncode!=0;assert restored.read_bytes()==original
    assert restored.stat().st_mode & 0o777==0o600


def test_storage_cap_refuses_oversized_state_without_replacing_ciphertext(tmp_path):
    source=tmp_path/'journal';cipher=tmp_path/'cloud-state.enc';source.write_bytes(os.urandom(900000));cipher.write_bytes(b'previous')
    assert crypt('seal',source,cipher).returncode!=0
    assert cipher.read_bytes()==b'previous'


@pytest.mark.parametrize('names',[['../cloud-state.enc'],['journal.json'],['cloud-state.enc','extra.json']])
def test_artifact_never_extracts_plaintext_or_arbitrary_archive_paths(names):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as archive:
        for name in names:archive.writestr(name,b'not plaintext')
    with pytest.raises(ValueError):artifacts.unpack(stream.getvalue())


def test_artifact_unpack_reads_only_the_single_ciphertext_file():
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as archive:archive.writestr('cloud-state.enc',b'ciphertext')
    assert artifacts.unpack(stream.getvalue())==b'ciphertext'


def setup_paths(tmp_path,monkeypatch):
    monkeypatch.setattr(offline,'PRIVATE_ROOT',tmp_path)
    monkeypatch.setattr(artifacts,'JOURNAL',tmp_path/'cloud'/'journal.json')
    monkeypatch.setattr(artifacts,'ENCRYPTED',tmp_path/'cloud'/'cloud-state.enc')
    monkeypatch.setenv('INTERNAL_SECRET',SECRET)


def test_first_hosted_run_bootstraps_without_reading_any_local_journal(tmp_path,monkeypatch):
    setup_paths(tmp_path,monkeypatch);github=Mock();github.artifacts.return_value=[];github.api.return_value={'total_count':0}
    artifacts.restore(github)
    assert not artifacts.JOURNAL.exists()


def test_missing_previously_successful_state_cannot_silently_restart_sources(tmp_path,monkeypatch):
    setup_paths(tmp_path,monkeypatch);github=Mock();github.artifacts.return_value=[];github.api.return_value={'total_count':1}
    with pytest.raises(ValueError,match='missing'):artifacts.restore(github)


def test_second_clean_runner_authenticates_and_resumes_previous_cloud_cursor(tmp_path,monkeypatch):
    setup_paths(tmp_path,monkeypatch);github=Mock();github.repository='hmapinheiro6/therecouldbeanapp'
    github.artifacts.return_value=[{'id':20,'workflow_run':{'id':123}},{'id':10,'workflow_run':{'id':100}}]
    github.api.side_effect=[{'path':'.github/workflows/cloud-discovery.yml','head_branch':'main','event':'workflow_dispatch'},None]
    source=tmp_path/'previous.json';cipher=tmp_path/'previous.enc'
    previous={'version':1,'checkpoints':{'hackernews':'retained-cursor'},'records':[], 'cloud':{'saved_run_id':123,'repository':github.repository}}
    source.write_text(json.dumps(previous));assert crypt('seal',source,cipher).returncode==0
    github.download.return_value=cipher.read_bytes();artifacts.restore(github)
    assert json.loads(artifacts.JOURNAL.read_text())['checkpoints']['hackernews']=='retained-cursor'
    github.api.assert_any_call('/actions/artifacts/10','DELETE')
    assert not any(call.args==('/actions/artifacts/20','DELETE') for call in github.api.call_args_list)


def test_untrusted_workflow_artifact_is_not_downloaded(tmp_path,monkeypatch):
    setup_paths(tmp_path,monkeypatch);github=Mock();github.artifacts.return_value=[{'id':20,'workflow_run':{'id':123}}]
    github.api.return_value={'path':'.github/workflows/untrusted.yml','head_branch':'main','event':'pull_request'}
    with pytest.raises(ValueError,match='trusted'):artifacts.restore(github)
    github.download.assert_not_called()
