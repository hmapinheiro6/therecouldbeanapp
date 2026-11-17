import json
from datetime import datetime,timezone
from unittest.mock import Mock
import pytest
from ingestion import expansion as ex
from ingestion import campaign
from ingestion.client import InternalAPIError

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setattr('ingestion.offline_discovery.PRIVATE_ROOT',tmp_path)
    config=tmp_path/'config.json';config.write_text(json.dumps({'id':'test','enabled':True,'target':10000,'deadline':'2026-11-17T23:50:00Z'}))
    monkeypatch.setattr(ex,'CONFIG',config);monkeypatch.setattr(ex,'HEALTH',tmp_path/'health.json');monkeypatch.setattr(ex,'JOURNAL',tmp_path/'journal.json')
    monkeypatch.setattr(ex,'campaign_active',lambda:True)
    state={'records':[{'candidate':{'canonical_url':'https://example.dev/'+str(i)},'status':'pending'} for i in range(20)]}
    client=Mock()
    def request(path,body=None):
        if path.endswith('/maintenance'):return {'status':'ready'}
        if path.endswith('/expansion-status'):return {'published':2868}
        if path.endswith('/known'):return {'known':[]}
        if '/identity-index?' in path:return {'products':[],'next_after':None}
        if path.endswith('/ingest'):return {'status':'accepted','products':len(body['products']),'catalog_total':2888,'accounting':{'rows_written':len(body['products'])*10}}
        raise AssertionError(path)
    client.request.side_effect=request
    return state,client,request

def test_only_acknowledged_new_products_count_and_progress_survives(setup):
    state,client,_=setup
    result=ex.publish(state,20,client,verify=lambda c:c)
    assert result['published_products']==2888 and result['published_by_campaign']==20
    assert state['records']==[] and state['observed_rows_written']==200

def test_quota_preserves_ready_outbox_without_claiming_publication(setup):
    state,client,request=setup
    def limited(path,body=None):
        if path.endswith('/ingest'):raise InternalAPIError(429,'limited','ingestion_daily_budget')
        return request(path,body)
    client.request.side_effect=limited
    result=ex.publish(state,20,client,verify=lambda c:c)
    assert result['status']=='quota_deferred' and result['published_by_campaign']==0
    assert all(r['status']=='ready' for r in state['records'])
    client.request.side_effect=request
    result=ex.publish(state,20,client,verify=lambda c:pytest.fail('Must not fetch ready results again'))
    assert result['published_by_campaign']==20

def test_failed_policy_record_does_not_poison_valid_batch(setup):
    state,client,request=setup
    def policy(path,body=None):
        if path.endswith('/ingest') and any(p['canonical_url'].endswith('/0') for p in body['products']):raise InternalAPIError(422,'blocked','publication_blocked')
        return request(path,body)
    client.request.side_effect=policy
    result=ex.publish(state,20,client,verify=lambda c:c)
    assert result['published_by_campaign']==19 and result['held']==1

def test_duplicate_resolved_homepages_are_not_counted_twice(setup):
    state,client,_=setup
    result=ex.publish(state,20,client,verify=lambda c:{'canonical_url':'https://example.dev'})
    assert result['published_by_campaign']==1

def test_unacknowledged_response_preserves_verified_products(setup):
    state,client,request=setup
    client.request.side_effect=lambda path,body=None: {'status':'unexpected'} if path.endswith('/ingest') else request(path,body)
    with pytest.raises(ValueError,match='not acknowledged'):ex.publish(state,20,client,verify=lambda c:c)
    assert all(r['status']=='ready' for r in state['records'])

def test_title_identity_and_same_host_canonical_are_required():
    candidate={'name':'Actual','aliases':['Actual'],'canonical_url':'https://actual.dev/download','licensed_description':'A useful independent application.','source_type':'feed','source_name':'Test','source_url':'https://source.dev','external_id':'actual','discovered_at':'2026-11-17T12:00:00Z'}
    page={'status':200,'url':candidate['canonical_url'],'content_type':'text/html','text':'<title>Actual software</title><link rel="canonical" href="https://actual.dev/"><p>Actual is an independent application that helps people organize their personal work and complete useful projects.</p>'}
    web=Mock();web.fetch.return_value=page
    assert ex.verify_candidate(candidate,web)['canonical_url']=='https://actual.dev'
    page['text']='<title>Domain for sale</title><p>Actual actual actual. '+('words '*30)+'</p>'
    with pytest.raises(ValueError):ex.verify_candidate(candidate,web)
    page['url']='https://other.dev'
    with pytest.raises(ValueError):ex.verify_candidate(candidate,web)

def test_campaign_priority_expires_without_a_local_scheduler(monkeypatch,tmp_path):
    monkeypatch.setattr(campaign,'ROOT',tmp_path);(tmp_path/'data').mkdir()
    (tmp_path/'data/expansion-campaign.json').write_text(json.dumps({'enabled':True,'deadline':'2026-11-17T23:50:00Z'}))
    assert campaign.expansion_priority(datetime(2026,11,17,12,tzinfo=timezone.utc))
    assert campaign.expansion_priority(datetime(2026,11,18,tzinfo=timezone.utc)) is None


def test_existing_name_at_another_url_holds_only_new_candidates(setup):
    state,client,request=setup
    existing={'id':1,'slug':'existing','name':'Actual','canonical_url':'https://actual.dev'}
    def indexed(path,body=None):
        if '/identity-index?' in path:return {'products':[existing],'next_after':None}
        return request(path,body)
    client.request.side_effect=indexed
    result=ex.publish(state,20,client,verify=lambda c:{**c,'name':'Actual'})
    assert result['held']==20 and result['published_by_campaign']==0
    assert not any(call.args[0].endswith('/ingest') or call.args[0].endswith('/moderate') for call in client.request.call_args_list)


def test_same_name_variants_in_one_batch_do_not_inflate_the_count(setup):
    state,client,_=setup
    result=ex.publish(state,20,client,verify=lambda c:{**c,'name':'Actual'})
    assert result['held']==19 and result['published_by_campaign']==1


def test_finishing_early_still_preserves_the_daily_allowance(monkeypatch,tmp_path):
    monkeypatch.setattr(campaign,'ROOT',tmp_path);(tmp_path/'data').mkdir()
    (tmp_path/'data/expansion-campaign.json').write_text(json.dumps({'enabled':True,'deadline':'2026-11-17T23:50:00Z'}))
    (tmp_path/'data/expansion-health.json').write_text(json.dumps({'status':'target_reached'}))
    assert campaign.expansion_priority(datetime(2026,11,17,18,tzinfo=timezone.utc))=='2026-11-17T23:50:00Z'


def test_cached_source_cannot_use_download_directories_or_generic_aliases():
    web=Mock();candidate={'name':'Actual','aliases':['Actual','Windows'],'canonical_url':'https://softsea.com/Actual.html'}
    with pytest.raises(ValueError,match='not an official'):ex.verify_candidate(candidate,web)
    web.fetch.assert_not_called()
    candidate['canonical_url']='https://actual.dev'
    web.fetch.return_value={'status':200,'url':'https://actual.dev','content_type':'text/html','text':'<title>Windows Downloads</title><p>'+('Generic publisher downloads. '*10)+'</p>'}
    with pytest.raises(ValueError,match='title'):ex.verify_candidate(candidate,web)
