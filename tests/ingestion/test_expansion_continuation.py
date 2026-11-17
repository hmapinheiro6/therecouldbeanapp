import json
from unittest.mock import Mock
from ingestion import expansion_continue as ex
from ingestion import expansion_snapshot as snap
import pytest


def test_continuation_is_finite_and_uses_hosted_dispatch(monkeypatch,tmp_path):
    monkeypatch.setattr(ex,'ROOT',tmp_path);monkeypatch.setattr(ex,'expansion_priority',lambda:'2026-11-17T23:50:00Z')
    (tmp_path/'data').mkdir();path=tmp_path/'data/expansion-health.json'
    value={'status':'running','published_products':3000,'target':10000,'deadline':'2026-11-17T23:50:00Z','checked_at':'2026-11-17T00:00:00Z'}
    path.write_text(json.dumps(value));github=Mock()
    assert ex.continue_campaign(github)
    assert github.api.call_args.args==('/actions/workflows/expansion.yml/dispatches','POST',{'ref':'main','inputs':{'audit':'false','checks':'1000'}})
    github.reset_mock();value['status']='quota_deferred';path.write_text(json.dumps(value))
    assert not ex.continue_campaign(github);github.api.assert_not_called()
    value['status']='running';path.write_text(json.dumps(value));monkeypatch.setattr(ex,'expansion_priority',lambda:None)
    assert not ex.continue_campaign(github);github.api.assert_not_called()


def test_watchdog_does_not_dispatch_over_running_or_failed_work(monkeypatch,tmp_path):
    monkeypatch.setattr(ex,'ROOT',tmp_path);monkeypatch.setattr(ex,'expansion_priority',lambda:True)
    (tmp_path/'data').mkdir();(tmp_path/'data/expansion-health.json').write_text(json.dumps({'status':'running','published_products':3000,'target':10000,'deadline':'later','checked_at':'2026-11-17T00:00:00Z'}))
    for status,conclusion in [('in_progress',None),('completed','failure')]:
        github=Mock();github.api.return_value={'workflow_runs':[{'id':1,'status':status,'conclusion':conclusion}]}
        assert not ex.continue_campaign(github,recover=True)
        assert github.api.call_count==1


def test_snapshot_export_preserves_previous_on_an_incomplete_page(monkeypatch,tmp_path):
    (tmp_path/'data').mkdir();(tmp_path/'public').mkdir();path=tmp_path/'snapshot.json'
    path.write_text(json.dumps({'products':[{'old':True}]}));previous=path.read_bytes()
    (tmp_path/'data/expansion-health.json').write_text(json.dumps({'status':'target_reached','published_products':10000}))
    monkeypatch.setattr(snap,'ROOT',tmp_path);monkeypatch.setattr(snap,'TARGET',path)
    client=Mock();client.request.return_value={'products':[],'next_after':None}
    with pytest.raises(ValueError,match='Incomplete'):snap.refresh(client)
    assert path.read_bytes()==previous


def test_snapshot_milestone_publishes_only_public_fields(monkeypatch,tmp_path):
    (tmp_path/'data').mkdir();(tmp_path/'public').mkdir();path=tmp_path/'snapshot.json'
    path.write_text(json.dumps({'products':[]}))
    (tmp_path/'data/expansion-health.json').write_text(json.dumps({'status':'target_reached','published_products':1}))
    (tmp_path/'data/categories.json').write_text(json.dumps([{'slug':'desktop-apps','name':'Desktop apps'}]))
    monkeypatch.setattr(snap,'ROOT',tmp_path);monkeypatch.setattr(snap,'TARGET',path)
    row={k:None for k in snap.FIELDS};row.update(id=1,slug='actual',name='Actual',canonical_url='https://actual.dev',category_slug='desktop-apps',category='Desktop apps',normalized_domain='actual.dev',verification_scope='identity',capabilities=[],sources=[{'source_name':'WinGet','source_url':'https://github.com/example/manifest'}],private_future_field='must not leak')
    client=Mock();client.request.return_value={'products':[row],'next_after':None}
    snap.refresh(client)
    assert len(json.loads(path.read_text())['products'])==1
    assert 'private_future_field' not in path.read_text()
    assert not (tmp_path/'public/catalog-backup.json').exists()
    client.request.assert_called_once_with('/api/internal/snapshot?after=0')
