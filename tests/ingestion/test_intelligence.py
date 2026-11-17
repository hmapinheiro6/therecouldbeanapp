"""Synthetic observations: evidence boundaries, retention and hosted collection budgets."""
import json
from unittest.mock import Mock
import pytest
from ingestion.extraction import Metadata
from ingestion import intelligence as intel
from ingestion.safe_web import FetchError

STAMP = '2026-11-17T12:00:00Z'
PRODUCT = {'slug':'actual', 'name':'Actual', 'canonical_url':'https://actual.dev', 'verification_scope':'capabilities'}


def page(text='<title>Actual</title>', **extra):
    return {'status':200, 'url':PRODUCT['canonical_url'], 'content_type':'text/html', 'text':text, **extra}


def metadata(text):
    parser=Metadata(); parser.feed(text); return parser


def observation(state):
    return {'state':state, 'source_url':PRODUCT['canonical_url'], 'http_status':200 if state=='reachable' else None}


def software(**extra):
    return {'@type':'SoftwareApplication', 'name':'Actual', 'url':'https://actual.dev', 'datePublished':'2020-05-12', 'softwareVersion':'2.1', **extra}


def facts(value):
    return intel.software_facts(PRODUCT, metadata('<script type="application/ld+json">'+json.dumps(value)+'</script>'), PRODUCT['canonical_url'], STAMP)


def test_only_product_matched_software_entities_supply_dates():
    result=facts({'@graph':[software(), {'@type':'Organization','name':'Actual','datePublished':'1990-01-01'}]})
    assert result['publication']['date']=='2020-05-12'
    assert result['publication']['kind']=='publisher_reported'
    assert result['version']['value']=='2.1'
    for entry in [software(name='Other'),software(url='https://actual.dev/blog/post'), software(**{'@type':'WebPage'}), software(**{'@type':[{'bad':1}]}), software(datePublished='2020'),software(datePublished='2020-05'),software(datePublished='2099-01-01'),software(datePublished='2020-02-30')]:
        assert 'publication' not in facts(entry)


@pytest.mark.parametrize('error,state',[(FetchError('Access restricted',False,403),'restricted'),(FetchError('Temporary HTTP 429',True,429),'restricted'),(FetchError('denied by robots.txt',False),'restricted'),(FetchError('DNS resolution failed'),'unreachable'),(FetchError('Network or TLS failure'),'unreachable'),(FetchError('Temporary HTTP 503',True,503),'unreachable'),(ValueError('private host'),'unknown')])
def test_access_restrictions_are_not_treated_as_closure(error,state):
    assert intel.website_observation(PRODUCT,error=error)['state']==state


@pytest.mark.parametrize('response,state',[(page(),'reachable'),(page(status=404),'unreachable'),(page('<title>Actual — domain for sale</title>'),'identity_unconfirmed'),(page(url='https://unrelated.dev'),'identity_unconfirmed'),(page('<title>Other</title>'),'identity_unconfirmed'),(page(content_type='application/json'),'unknown')])
def test_reachability_requires_matching_product_identity(response,state):
    assert intel.website_observation(PRODUCT,response,metadata(response['text']))['state']==state


def test_daily_observations_deduplicate_retain_history_and_never_infer_continuous_uptime():
    old=None
    for day in ['2026-11-14','2026-11-14','2026-11-15','2026-11-16']:
        old=intel.update_record(PRODUCT,old,observation('unreachable'),stamp=day+'T12:00:00Z')
    assert old['website']['failed_observation_days']==3
    assert len(old['checks'])==3 and len(old['history'])==1
    result=intel.update_record(PRODUCT,old,observation('reachable'),stamp=STAMP)
    assert result['website']['failed_observation_days']==0
    assert result['website']['last_reachable_at']==STAMP
    assert len(result['history'])==2
    assert 'uptime' not in json.dumps(result)
    result=intel.update_record({**PRODUCT,'canonical_url':'https://new.dev'},result,observation('unknown'),stamp=STAMP)
    assert len(result['history'])==1 and result['first_observed_at']==STAMP


def test_failed_refresh_preserves_dated_facts_and_history_is_bounded():
    from datetime import datetime, timedelta, timezone
    old=None
    for n in range(70):
        stamp=(datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(days=n)).isoformat()
        old=intel.update_record(PRODUCT,old,observation('reachable' if n%2 else 'unreachable'),facts(software()) if n==0 else {},stamp,enriched=True)
    assert len(old['checks'])==56 and len(old['history'])==32
    assert old['facts']['publication']['date']=='2020-05-12'
    assert old['enriched_at']==stamp


def response(data, **extra): return {'status':200, 'text':json.dumps(data), **extra}


def release(date,tag,**extra):
    return {'published_at':date,'created_at':'1999-01-01','tag_name':tag,'html_url':'https://github.com/owner/actual/releases/tag/'+tag,'draft':False,'prerelease':False,**extra}


def test_repository_creation_and_releases_are_separate_and_pagination_is_bounded():
    web=Mock(); api='https://api.github.com/repos/owner/actual'
    web._raw.side_effect=[response({'private':False,'html_url':'https://github.com/owner/actual','homepage':PRODUCT['canonical_url'],'created_at':'2018-03-04T12:00:00Z','archived':False}),response([release('2026-11-10T12:00:00Z','v3'),release('2026-11-15T12:00:00Z','v4',prerelease=True)],links='<'+api+'/releases?per_page=10&page=90>; rel="last"'),response([release('2020-05-12T12:00:00Z','v1'),release('2019-01-01T12:00:00Z','draft',draft=True)])]
    f=intel.github_facts(PRODUCT,'https://github.com/owner/actual',web,STAMP)
    assert f['repository_created']['date']=='2018-03-04'
    assert f['earliest_release']['date']=='2020-05-12' and f['latest_release']['value']=='v3'
    assert 'publication' not in f and web._raw.call_count==3


@pytest.mark.parametrize('metadata', [{'private':True,'homepage':PRODUCT['canonical_url']},{'private':False,'homepage':'https://other.dev'}])
def test_unrelated_or_private_repositories_cannot_supply_product_dates(metadata):
    web=Mock();web._raw.return_value=response({**metadata,'html_url':'https://github.com/owner/actual'})
    assert intel.github_facts(PRODUCT,'https://github.com/owner/actual',web,STAMP)=={}
    assert web._raw.call_count==1


def test_release_failure_preserves_repository_metadata_and_hostile_pagination_is_ignored():
    web=Mock();info=response({'private':False,'html_url':'https://github.com/owner/actual','homepage':PRODUCT['canonical_url'],'created_at':'2018-03-04','archived':True})
    for ending in [FetchError('restricted',False,403),response([],links='<https://evil.dev/release>; rel="last"')]:
        web.reset_mock();web._raw.side_effect=[info,ending]
        assert intel.github_facts(PRODUCT,'https://github.com/owner/actual',web,STAMP)['repository_created']['date']=='2018-03-04'
        assert web._raw.call_count==2


def test_changelog_dates_exclude_footer_and_unrelated_pages():
    web=Mock();web.fetch.side_effect=[page('<title>Actual</title><a href="/changelog">Updates</a>'),page('<title>Actual updates</title><time datetime="2026-10-30">Update</time><footer><time datetime="2026-11-17">Copyright</time></footer>',url='https://actual.dev/changelog')]
    result=intel.collect(PRODUCT,web=web,github=Mock(),stamp=STAMP)
    assert result['facts']['changelog_entry']['date']=='2026-10-30'
    assert web.fetch.call_count==2


def test_retries_take_priority_over_new_products_and_preview_checks_do_not_starve_enrichment(tmp_path,monkeypatch):
    monkeypatch.setattr(intel,'now',lambda: STAMP)
    old=intel.update_record(PRODUCT,None,observation('unreachable'),stamp='2026-11-15T12:00:00Z',enriched=True)
    intel.save_record(tmp_path/'actual.json',old)
    web=Mock();web.fetch.return_value=page()
    result=intel.run(1,tmp_path,[{'slug':'aaa','name':'Aaa','canonical_url':'https://aaa.dev'},PRODUCT],lambda **_:web)
    assert result['checked']==1 and result['d1_writes']==0
    assert json.loads((tmp_path/'actual.json').read_text())['website']['state']=='reachable'
    assert not (tmp_path/'aaa.json').exists()
    assert intel.run(1,tmp_path,[PRODUCT],lambda **_:web)['checked']==0
    # A preview check has no enriched_at; it still gets its full metadata/release check.
    old['enriched_at']=None;intel.save_record(tmp_path/'actual.json',old)
    assert intel.run(1,tmp_path,[PRODUCT],lambda **_:web)['checked']==1


def test_preview_reuses_html_and_storage_budget_prevents_a_write(tmp_path,monkeypatch):
    monkeypatch.setattr(intel,'DIRECTORY',tmp_path)
    monkeypatch.setattr(intel,'MAX_TOTAL',10)
    intel.observe_preview(PRODUCT,page(),metadata('<title>Actual</title>'))
    assert not list(tmp_path.glob('*.json'))


def test_new_forward_index_counts_toward_the_storage_file_budget(tmp_path,monkeypatch):
    monkeypatch.setattr(intel,'MAX_RECORDS',1)
    monkeypatch.setattr(intel,'snapshot_products',lambda: [])
    def indexed(*args):
        (tmp_path/'.catalog-index.json').write_text('{}')
        return [PRODUCT]
    monkeypatch.setattr(intel,'published_products',indexed)
    web=Mock()
    assert intel.run(1,tmp_path,web_factory=lambda **_:web)['checked']==0
    web.fetch.assert_not_called()
    assert not (tmp_path/'actual.json').exists()


def test_large_source_history_trims_to_the_record_byte_budget():
    old=None
    for n in range(32):
        site={**observation('reachable' if n%2 else 'unreachable'),'source_url':'https://actual.dev/'+('a'*1900)}
        old=intel.update_record(PRODUCT,old,site,stamp=STAMP)
    assert len(old['history']) < 32
    assert len(json.dumps(old,ensure_ascii=True,separators=(',',':')).encode())+1 <= intel.MAX_BYTES


@pytest.mark.parametrize('numeric_id,requests,earliest',[(1234,3,'2018-05-01'),(9999,2,'2026-11-10')])
def test_numeric_github_pagination_is_verified_then_rewritten_to_fixed_repository(numeric_id,requests,earliest):
    web=Mock();api='https://api.github.com/repos/owner/actual'
    web._raw.side_effect=[response({'id':1234,'private':False,'html_url':'https://github.com/owner/actual','homepage':PRODUCT['canonical_url'],'created_at':'2017-03-04','archived':False}),response([release('2026-11-10T12:00:00Z','v3')],links='<https://api.github.com/repositories/'+str(numeric_id)+'/releases?per_page=10&page=7>; rel="last"'),response([release('2018-05-01T12:00:00Z','v1')])]
    f=intel.github_facts(PRODUCT,'https://github.com/owner/actual',web,STAMP)
    assert f['earliest_release']['date']==earliest
    assert web._raw.call_count==requests
    if requests==3: assert web._raw.call_args.args[0]==api+'/releases?per_page=10&page=7'


def test_own_public_identity_feed_is_allowed_without_opening_private_routes():
    from urllib.robotparser import RobotFileParser
    from ingestion.safe_web import USER_AGENT
    parser=RobotFileParser();parser.parse((intel.ROOT/'public/robots.txt').read_text().splitlines())
    site='https://therecouldbeanapp.henriquepinheiro.workers.dev'
    assert parser.can_fetch(USER_AGENT,site+'/catalog/products.json')
    assert not parser.can_fetch(USER_AGENT,site+'/api/preview-products?after=300')
    assert not parser.can_fetch(USER_AGENT,site+'/api/admin/candidates')
    assert not parser.can_fetch(USER_AGENT,site+'/api/search?q=test')
