import copy
import json
from unittest.mock import Mock, patch
import pytest
from ingestion.cloud_discovery import deliver, review_record
from ingestion.client import InternalAPIError
from ingestion.offline_discovery import new_state
from ingestion.safe_web import SafeWeb


@pytest.fixture(autouse=True)
def isolate_test_job_outputs(monkeypatch):
    monkeypatch.delenv('GITHUB_STEP_SUMMARY', raising=False)
    monkeypatch.delenv('GITHUB_OUTPUT', raising=False)


def record(status='held'):
    return {'id':'cloud-1','status':status,'reason':'Needs official identity review',
        'candidate': {'name':'ActualApp','canonical_url':'https://actual.dev','source_name':'Hacker News',
            'source_type':'hackernews','source_url':'https://news.ycombinator.com/item?id=1',
            'external_id':'1','discovered_at':'2026-11-16T00:00:00Z'}}


def state():
    value=new_state(2);value['records']=[record()];return value


def test_blocked_database_keeps_cloud_records_and_cursor_for_the_next_runner():
    value=state();original=copy.deepcopy(value);saved=[];client=Mock()
    client.request.side_effect=InternalAPIError(503,'Quota','database_daily_limit','2099-01-01T00:00:00Z')
    result=deliver(value,lambda x:saved.append(copy.deepcopy(x)),client_factory=lambda:client)
    assert result['outcome']=='deferred';assert result['queued_to_d1']==0
    assert value['records']==original['records'];assert value['checkpoints']==original['checkpoints']
    assert saved[-1]['delivery']['retry_at']=='2099-01-01T00:00:00Z'
    client.request.assert_called_once_with('/api/internal/maintenance',{})


def test_saved_reset_avoids_repeated_database_probes():
    value=state();value['delivery']={'retry_at':'2099-01-01T00:00:00Z'};factory=Mock()
    assert deliver(value,Mock(),client_factory=factory)['outcome']=='deferred'
    factory.assert_not_called()


def test_delivery_is_acknowledged_before_removing_outbox_records():
    value=state();client=Mock();saved=[]
    client.request.side_effect=[{'status':'ready'},{'known':[]},{'status':'accepted'}]
    result=deliver(value,lambda x:saved.append(copy.deepcopy(x)),client_factory=lambda:client)
    assert result['queued_to_d1']==1;assert not value['records'];assert not saved[-1]['records']
    posted=client.request.call_args_list[-1].args[1]
    assert posted['candidates'][0]['status']=='needs_review';assert 'products' not in posted


def test_failed_write_retains_outbox_for_idempotent_retry():
    value=state();client=Mock()
    client.request.side_effect=[{'status':'ready'},{'known':[]},InternalAPIError(500,'Failure')]
    with pytest.raises(InternalAPIError):deliver(value,Mock(),client_factory=lambda:client)
    assert len(value['records'])==1


def test_published_or_rejected_remote_identity_is_not_requeued():
    value=state();client=Mock();client.request.side_effect=[{'status':'ready'},{'known':['https://actual.dev']}]
    assert deliver(value,Mock(),client_factory=lambda:client)['queued_to_d1']==0
    assert not value['records'];assert client.request.call_count==2


def test_auth_failure_cannot_be_called_a_quota_pause():
    client=Mock();client.request.side_effect=InternalAPIError(401,'Unauthorized')
    with pytest.raises(InternalAPIError):deliver(state(),Mock(),client_factory=lambda:client)


def test_new_product_claims_cannot_be_published_by_cloud_collector():
    value=record('draft');value['draft']={'product':{'verification_scope':'capabilities','capabilities':[{'slug':'crm'}]}}
    with pytest.raises(ValueError,match='identity-only'):review_record(value)


def test_queue_only_processing_never_fetches_external_sources():
    from ingestion.run import run
    with patch('ingestion.run.Sources') as sources, patch('ingestion.run.InternalClient') as clients:
        clients.return_value.request.return_value={'submissions':[],'candidates':[],'checkpoints':[]}
        assert run(False,1,queue_only=True)==0
        sources.return_value.hackernews.assert_not_called();sources.return_value.github.assert_not_called()


@pytest.mark.parametrize('url,expected', [('https://api.github.com/search/repositories?q=saas',True),
    ('https://actual.dev/search/repositories',False),('https://api.github.com/repos/owner/repo',False)])
def test_github_runner_token_is_scoped_to_the_search_api(url,expected):
    response=Mock();response.status=200;response.read.return_value=b'{}';response.getheader.return_value=None
    connection=Mock();connection.getresponse.return_value=response
    with patch('ingestion.safe_web.resolve_public',return_value=['1.1.1.1']),patch('ingestion.safe_web.PinnedHTTPS',return_value=connection):
        SafeWeb(delay=0,github_token='test-scoped-token')._raw(url)
    headers=connection.request.call_args.kwargs['headers']
    assert ('Authorization' in headers)==expected


def test_cross_host_redirect_never_receives_the_runner_token():
    first=Mock();first.status=302;first.getheader.side_effect=lambda name,default=None:'https://actual.dev/' if name=='Location' else default
    second=Mock();second.status=200;second.read.return_value=b'{}';second.getheader.return_value=None
    origin,destination=Mock(),Mock();origin.getresponse.return_value=first;destination.getresponse.return_value=second
    with patch('ingestion.safe_web.resolve_public',return_value=['1.1.1.1']),patch('ingestion.safe_web.PinnedHTTPS',side_effect=[origin,destination]),patch.object(SafeWeb,'allowed',return_value=True):
        SafeWeb(delay=0,github_token='test-scoped-token')._raw('https://api.github.com/search/repositories?q=saas')
    assert 'Authorization' not in destination.request.call_args.kwargs['headers']


def test_entire_hosted_collection_continues_when_database_delivery_is_blocked(tmp_path,monkeypatch):
    from ingestion import cloud_discovery as cloud
    from ingestion import offline_discovery as offline
    monkeypatch.setattr(offline,'PRIVATE_ROOT',tmp_path)
    monkeypatch.setattr(cloud,'JOURNAL',tmp_path/'cloud'/'journal.json')
    with patch('ingestion.cloud_discovery.Sources') as sources,patch('ingestion.cloud_discovery.deliver',return_value={'outcome':'deferred','queued_to_d1':0}),patch('ingestion.cloud_discovery.offline.verify_pending',return_value=0):
        sources.return_value.hackernews.return_value=([record()['candidate']],'advanced-hn')
        sources.return_value.github.return_value=([],'advanced-github')
        assert cloud.run(1,1)==0
    saved=json.loads((tmp_path/'cloud'/'journal.json').read_text())
    assert len(saved['records'])==1
    assert saved['checkpoints']['hackernews']=='advanced-hn'
    assert saved['runs'][-1]['delivery']['outcome']=='deferred'


def test_bad_first_record_is_quarantined_and_valid_records_still_drain_after_restart():
    value=state();bad=record();bad['id']='poisoned';bad['candidate']['canonical_url']='https://actual.dev/?q='+'x'*2050
    value['records'].insert(0,bad);client=Mock();saved=[]
    client.request.side_effect=[{'status':'ready'},{'known':[]},{'status':'accepted'}]
    result=deliver(value,lambda x:saved.append(copy.deepcopy(x)),client_factory=lambda:client)
    assert result['queued_to_d1']==1;assert value['records']==[]
    assert value['quarantined'][0]['record']['id']=='poisoned'
    known_request=client.request.call_args_list[1].args[1]
    assert known_request=={'urls':['https://actual.dev']}
    resumed=copy.deepcopy(saved[-1]);client.reset_mock();client.request.side_effect=[{'status':'ready'}]
    assert deliver(resumed,Mock(),client_factory=lambda:client)['queued_to_d1']==0
    assert len(resumed['quarantined'])==1


def test_queue_name_respects_javascript_utf16_limits():
    value=record();value['candidate']['name']='🙂'*100
    payload=review_record(value)
    assert len(payload['name'].encode('utf-16-le'))//2==100


def test_source_rejects_overlong_urls_before_they_enter_cloud_state():
    from ingestion.sources import parse_hn
    assert parse_hn({'title':'Show HN: App','id':1,'time':1,'url':'https://actual.dev/?q='+'x'*2050}) is None


def test_queue_only_prepares_evidence_for_operator_instead_of_publishing_claims():
    from ingestion.run import run
    client=Mock();client.request.return_value={'submissions':[{'status':'pending','product_name':'ActualApp','submitted_url':'https://actual.dev','id':'00000000-0000-4000-8000-000000000001','created_at':'2026-11-16T00:00:00Z'}],'candidates':[],'checkpoints':[]}
    product={'name':'ActualApp','capabilities':[{'slug':'crm','evidence_text':'ActualApp provides customer relationship management software.'}]}
    with patch('ingestion.run.InternalClient',return_value=client),patch('ingestion.run.verify',return_value=product):
        assert run(False,1,queue_only=True)==0
    writes=[call.args[1] for call in client.request.call_args_list if call.args[0]=='/api/internal/ingest']
    assert all('products' not in write for write in writes)
    drafted=[write['candidates'][0] for write in writes if write.get('candidates')][0]
    assert drafted['status']=='needs_review';assert json.loads(drafted['review_draft_json'])['capabilities']
