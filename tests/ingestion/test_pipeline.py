import json
import socket
from unittest.mock import patch,Mock
import pytest
from ingestion.safe_web import canonicalize,resolve_public,UnsafeURL,SafeWeb,FetchError
from ingestion.extraction import Metadata,evidence_from,verify,now
from ingestion.sources import parse_hn,parse_github,parse_feed
from ingestion.run import queue_record,identity
from ingestion.seed import emit

@pytest.mark.parametrize('url',['http://public.dev','file:///etc/passwd','https://localhost','https://127.0.0.1','https://[::1]','https://user:password@public.dev','https://public.dev:444','https://private.internal','https://metadata.google.internal'])
def test_rejects_unsafe_urls(url):
    with pytest.raises((ValueError,UnsafeURL)):canonicalize(url)

def test_canonicalization_preserves_distinct_products():
    assert canonicalize('https://WWW.public.dev/a/?utm_source=x&z=2&a=1#frag')=='https://public.dev/a?a=1&z=2'
    assert canonicalize('https://public.dev/products/a')!=canonicalize('https://public.dev/products/b')

def test_fetch_preserves_slash_and_www_for_redirects():
    assert canonicalize('https://www.public.dev/features/',keep_www=True)=='https://www.public.dev/features/'

@pytest.mark.parametrize('addresses',[['127.0.0.1'],['10.0.0.1'],['169.254.169.254'],['192.168.1.2'],['::1'],['1.1.1.1','192.168.0.1'],['2001:db8::1']])
def test_dns_rejects_private_reserved_and_mixed_answers(addresses):
    with patch('socket.getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,0,'',(a,443)) for a in addresses]):
        with pytest.raises(UnsafeURL):resolve_public('public.dev')

def test_dns_returns_validated_public_address_for_pinned_socket():
    with patch('socket.getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,0,'',('1.1.1.1',443))]):assert resolve_public('public.dev')==['1.1.1.1']

def test_robots_denial_prevents_content_fetch():
    web=SafeWeb(delay=0)
    with patch.object(web,'_raw',return_value={'status':200,'text':'User-agent: *\nDisallow: /','content_type':'text/plain','url':'https://public.dev/robots.txt'}) as raw:
        with pytest.raises(FetchError,match='robots'):web.fetch('https://public.dev')
        assert raw.call_count==1

def test_robot_404_allows_public_page_and_bounded_page_budget():
    web=SafeWeb(delay=0,max_pages=1)
    with patch.object(web,'_raw',side_effect=[{'status':404,'text':''},{'status':200,'text':'okay'}]):
        assert web.fetch('https://public.dev')['status']==200
        with pytest.raises(FetchError,match='budget'):web.fetch('https://public.dev/features')

def test_html_extracts_metadata_and_ignores_scripts():
    p=Metadata();p.feed('<title>ActualApp</title><meta name="description" content="Project management software"><script>password manager</script><p>Tracks projects</p><script type="application/ld+json">{"@type":"SoftwareApplication","name":"ActualApp"}</script>')
    assert p.title=='ActualApp';assert p.json_ld[0]['name']=='ActualApp'
    claims=evidence_from(p.sentences());assert any(c['slug']=='projects' for c in claims)
    assert not any(c['slug']=='passwords' for c in claims)

def test_negated_and_integration_claims_are_not_capabilities():
    assert evidence_from(['Not a password manager','Integrates with project management tools'])==[]

def test_verification_requires_name_and_capability_evidence():
    c={'name':'ActualApp','canonical_url':'https://actual.dev','source_name':'Test','source_url':'https://actual.dev','external_id':'x','discovered_at':'2020-01-01T00:00:00Z'}
    web=Mock();web.fetch.return_value={'status':200,'content_type':'text/html','url':'https://actual.dev','text':'<title>ActualApp</title><h1>Project management software</h1><p>ActualApp gives your team project management tools for organizing work and software delivery.</p>'}
    result=verify(c,web);assert result['capabilities'][0]['slug']=='projects';assert result['source']['external_id']=='x';assert result['announced_at'] is None
    assert result['short_description'].startswith('ActualApp provides')
    assert result['first_seen_at']==result['last_verified_at']
    assert result['source']['discovered_at']=='2020-01-01T00:00:00Z'
    c['name']='InventedName'
    with pytest.raises(FetchError,match='name'):verify(c,web)

def test_hackernews_launch_filtering_and_timestamps():
    item={'id':42,'title':'Show HN: ActualApp – Project management','url':'https://actual.dev','time':1700000000}
    c=parse_hn(item);assert c['name']=='ActualApp';assert c['source_url'].endswith('id=42');assert '2023' in c['discovered_at']
    assert parse_hn({**item,'title':'Ask HN: What should I build?'}) is None
    assert parse_hn({**item,'title':'Show HN: Tutorial for a starter template'}) is None

def test_github_excludes_templates_and_does_not_invent_launch_date():
    repo={'id':1,'name':'ActualApp','homepage':'https://actual.dev','description':'Project management software','size':100,'topics':['productivity'],'stargazers_count':8,'html_url':'https://github.com/maker/actual','created_at':'2020-01-01T00:00:00Z'}
    c=parse_github(repo);assert c['name']=='ActualApp';assert 'announced_at' not in c;assert c['discovered_at']!='2020-01-01T00:00:00Z'
    assert parse_github({**repo,'description':'starter template'}) is None
    assert parse_github({**repo,'homepage':''}) is None

def test_feed_adapters_only_extract_factual_identifiers():
    rss='<rss><channel><item><title>ActualApp</title><link>https://actual.dev</link><guid>42</guid><description>DO NOT COPY</description></item></channel></rss>'
    assert parse_feed(rss)==[{'name':'ActualApp','canonical_url':'https://actual.dev','external_id':'42'}]
    atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>App</title><link href="https://app.dev"/><id>1</id></entry></feed>'
    assert parse_feed(atom)[0]['name']=='App'
    assert parse_feed(json.dumps({'items':[{'id':'1','title':'App','url':'https://app.dev'}]}),'json')[0]['external_id']=='1'
    with pytest.raises(ValueError):parse_feed('<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>')

def test_retry_identity_and_backoff_are_stable():
    c={'name':'Actual','canonical_url':'https://actual.dev','source_name':'HN','source_url':'https://news.ycombinator.com/item?id=1','external_id':'1','attempts':1}
    first=queue_record(c,'pending_verification','Temporary failure')
    second=queue_record(c,'pending_verification','Temporary failure')
    assert first['id']==second['id']==identity(c);assert first['attempts']==2;assert first['next_retry_at']>now()

def test_seed_snapshot_is_public_only(tmp_path):
    products=json.load(open('data/seeds/catalog.json'))
    assert len(products)>0
    target=tmp_path/'seed.sql';emit(products,target)
    assert 'contact_email' not in target.read_text();assert 'moderation_reason' not in target.read_text()

def test_sources_remain_disabled_without_permissions():
    assert all(not f['enabled'] or f.get('permission_cleared_at') for f in json.load(open('data/feeds.json')))

def test_internal_client_refuses_redirects():
    from ingestion.client import NoRedirect
    assert NoRedirect().redirect_request(None,None,302,'Found',{},'https://different.dev') is None

def test_failed_run_is_persisted_without_advancing_checkpoints():
    from ingestion.run import run
    client=Mock();client.request.side_effect=[{'submissions':[],'candidates':[],'checkpoints':[]},None,RuntimeError('write failure'),None]
    with patch('ingestion.run.InternalClient',return_value=client),patch('ingestion.run.Sources') as source:
        source.return_value.hackernews.side_effect=RuntimeError('source crashed')
        with pytest.raises(RuntimeError):run(False,1)
    calls=[c for c in client.request.call_args_list if c.args[0]=='/api/internal/ingest']
    assert any(c.args[1].get('run',{}).get('status')=='failed' for c in calls)
    assert all(not c.args[1].get('checkpoints') for c in calls)

def test_public_ipv4_is_preferred_on_ipv4_only_cloud_runners():
    answers=[(socket.AF_INET6,socket.SOCK_STREAM,0,'',('2606:4700:4700::1111',443)),(socket.AF_INET,socket.SOCK_STREAM,0,'',('1.1.1.1',443))]
    with patch('socket.getaddrinfo',return_value=answers):assert resolve_public('public.dev')==['1.1.1.1','2606:4700:4700::1111']

def test_app_connections_do_not_assert_workflow_automation():
    claims=evidence_from(['Connect apps through MCP'])
    assert [c['slug'] for c in claims]==['app-connections']


def test_navigation_and_oversized_fragments_are_not_capability_evidence():
    p=Metadata();p.feed('<title>ActualApp</title><main><p>ActualApp is a public software tool for simple everyday work.</p></main><nav>Project management software</nav><footer>Password manager platform</footer>')
    assert evidence_from(p.sentences())==[]
    assert evidence_from(['Project management '+('unrelated words '*50)])==[]


def test_show_hn_consumes_oldest_first_across_pages_and_preserves_timestamp_ties():
    from ingestion.sources import Sources
    source=Sources(Mock())
    def hit(i,t):return {'objectID':str(i),'created_at_i':t,'title':'Show HN: ActualApp – project management','url':f'https://actual{i}.dev'}
    responses=[{'nbPages':2,'hits':[hit(9,1002)]},{'nbPages':2,'hits':[hit(8,1001),hit(7,1001)]}]
    with patch.object(source,'json',side_effect=responses):
        items,cursor=source.hackernews('1000:0',1)
    assert [c['external_id'] for c in items]==['7'];assert cursor=='1001:7'
    with patch.object(source,'json',side_effect=responses):
        items,cursor=source.hackernews(cursor,1)
    assert [c['external_id'] for c in items]==['8'];assert cursor=='1001:8'


def test_show_hn_never_silently_advances_past_truncated_window():
    from ingestion.sources import Sources
    source=Sources(Mock())
    with patch.object(source,'json',return_value={'nbPages':6,'hits':[]}):
        with pytest.raises(FetchError,match='pagination'):source.hackernews('1000:0',10)


def test_github_keeps_unconsumed_candidates_without_star_threshold():
    from ingestion.sources import Sources
    source=Sources(Mock())
    repos=[{'id':i,'name':f'Actual{i}','homepage':f'https://actual{i}.dev','description':'Project management software','size':100,'topics':['saas'],'stargazers_count':0,'html_url':f'https://github.com/maker/actual{i}'} for i in (1,2,3)]
    payload={'items':repos,'total_count':3,'incomplete_results':False}
    start=json.dumps({'day':'2026-01-01','page':1,'offset':0})
    with patch.object(source,'json',return_value=payload) as fetch:
        first,cursor=source.github(start,1,'saas')
        second,cursor=source.github(cursor,1,'saas')
        third,cursor=source.github(cursor,10,'saas')
    assert [c['external_id'] for c in first+second+third]==['1','2','3']
    assert json.loads(cursor)['day']=='2026-01-02'
    assert 'stars' not in fetch.call_args.args[0]


def test_incomplete_github_window_is_not_checkpointed():
    from ingestion.sources import Sources
    source=Sources(Mock())
    with patch.object(source,'json',return_value={'items':[],'incomplete_results':True}):
        with pytest.raises(FetchError,match='incomplete'):source.github(None,10)


def test_descriptive_launch_title_can_resolve_explicit_official_brand():
    c={'name':'I built a project management tool','canonical_url':'https://actualapp.dev','source_name':'Hacker News','source_url':'https://news.ycombinator.com/item?id=42','external_id':'42','resolve_identity':True}
    web=Mock();web.fetch.return_value={'status':200,'content_type':'text/html','url':'https://actualapp.dev','text':'<title>ActualApp | Project management</title><meta property="og:site_name" content="ActualApp"><h1>ActualApp</h1><p>ActualApp is project management software that helps teams organize their work and plan upcoming projects.</p>'}
    assert verify(c,web)['name']=='ActualApp'
    web.fetch.return_value['text']=web.fetch.return_value['text'].replace('ActualApp','DifferentBrand')
    with pytest.raises(FetchError,match='name'):verify(c,web)


def test_source_quotas_allow_github_even_when_show_hn_is_busy():
    from ingestion.run import run
    sample={'name':'ActualApp','canonical_url':'https://actual.dev','source_name':'Hacker News','source_type':'hackernews','source_url':'https://news.ycombinator.com/item?id=1','external_id':'1'}
    with patch('ingestion.run.Sources') as source,patch('ingestion.run.verify',side_effect=FetchError('Review',False)):
        source.return_value.hackernews.side_effect=lambda checkpoint,limit:([{**sample,'external_id':str(i)} for i in range(limit)],'1000:1')
        source.return_value.github.return_value=([],None)
        assert run(True,40)==0
        assert source.return_value.github.call_count==3
        assert source.return_value.hackernews.call_args.kwargs['limit']<40


@pytest.mark.parametrize('sentence',[
 'Built by a freelance video editor',
 'E-Commerce SEO',
 'Our scanner provides CI/CD pipeline hardening checks',
 "They are kept on your computer or in your own cloud storage",
 'bun and pnpm share files between projects',
 'Type in a follow-up field to ask a question',
 'Monday: rate Tuesday: send Thursday: follow up Friday: read',
])
def test_incidental_mentions_are_not_product_capabilities(sentence):
    assert evidence_from([sentence])==[]


def test_direct_product_claims_remain_publishable():
    claims=evidence_from(['Error tracking and product analytics in one self-hosted stack','Staff schedule and timesheets','A cloud storage service to store your files securely online'])
    assert {'monitoring','analytics','time','storage'}<={c['slug'] for c in claims}


def test_ci_security_scanning_is_not_continuous_integration():
    assert evidence_from(['CI/CD security flags GitHub Actions pinned to mutable tags'])==[]
    assert [c['slug'] for c in evidence_from(['A continuous integration platform for automated builds'])]==['ci']


def test_agency_brand_cannot_replace_a_tool_name_on_a_nested_page():
    from ingestion.extraction import confirmed_name
    p=Metadata();p.feed('<title>Agency | Free Tool</title><h1>Agency provides this free tool</h1>')
    with pytest.raises(FetchError,match='name'):
        confirmed_name({'name':'A new tool','resolve_identity':True},p,'agency provides this free tool','https://agency.dev/free-tool')


@pytest.mark.parametrize('sentence',[
 'Estimated total cost for each customer each month, including payment processing',
 'The remaining amount pays for development time, customer support, and profit',
 'Search engine API directory',
 'Portrait concepts Use prompt Graphic design Use prompt Wildlife Use prompt',
 'Past the minutes, meeting recording waits until the week resets',
 'Follow-up email',
 'Create short videos with a generation model',
])
def test_prices_navigation_and_examples_are_not_capabilities(sentence):
    assert evidence_from([sentence])==[]


def test_supported_services_keep_their_direct_claims():
    assert {'payments','support','search'}<={c['slug'] for c in evidence_from(['Our payment processing service helps you accept payments','Lumora runs your support inbox and sales pipeline','A full text search platform for your website'])}


def test_backfill_filters_versions_fonts_and_non_apps_and_deduplicates():
    from ingestion.backfill import candidates_from
    base={'token':'actual','name':['Actual App'],'desc':'A real desktop application','homepage':'https://actual.dev','artifacts':[{'app':['Actual.app']}]}
    rows=[base,{**base,'token':'duplicate'},{**base,'token':'actual@beta'},{**base,'token':'font-actual'},{**base,'token':'disabled','disabled':True},{**base,'token':'installer','artifacts':[{'pkg':['a.pkg']}]},{**base,'token':'private','homepage':'https://127.0.0.1'}]
    result=candidates_from(rows);assert len(result)==1;assert result[0]['licensed_description']==base['desc']


def test_identity_backfill_never_invents_feature_claims():
    from ingestion.backfill import verify_identity
    c={'name':'ActualApp','aliases':['ActualApp'],'canonical_url':'https://actual.dev','licensed_description':'Product management software','source_name':'Homebrew Cask (BSD-2-Clause)','source_type':'feed','source_url':'https://formulae.brew.sh/cask/actual','external_id':'actual','discovered_at':now()}
    with patch('ingestion.backfill.SafeWeb') as web:
        web.return_value.fetch.return_value={'status':200,'content_type':'text/html','url':'https://actual.dev','text':'<title>ActualApp official website</title><p>ActualApp is an application for organizing everyday work on your desktop computer. Download the current version.</p>'}
        p=verify_identity(c)
    assert p['verification_scope']=='identity';assert p['capabilities']==[];assert p['identity_evidence_text']=='ActualApp official website';assert p['source']['source_name'].startswith('Homebrew')


def test_missing_meta_content_does_not_crash_a_bulk_run():
    p=Metadata();p.feed('<title>ActualApp official website</title><meta name="description" content><meta property="og:description"><p>ActualApp is a useful desktop application for everyday work.</p>')
    assert p.meta['description']=='';assert p.sentences()


def test_selfhosted_metadata_preserves_attribution_without_directory_markup():
    from ingestion.backfill import selfhosted_candidates
    rows=selfhosted_candidates('- [ActualApp](https://actual.dev) - A project collaboration application. ([Demo](https://demo.actual.dev)) `MIT` `Python`\n- [Again](https://actual.dev) - Duplicate.')
    assert len(rows)==1;assert rows[0]['licensed_description']=='A project collaboration application.';assert rows[0]['source_name']=='Awesome-Selfhosted (CC-BY-SA-3.0)';assert rows[0]['category_slug']=='web-apps'

def test_daily_database_quota_is_not_retried_in_a_tight_loop():
    from io import BytesIO
    from urllib.error import HTTPError
    from ingestion.client import InternalClient,InternalAPIError
    opener=Mock()
    opener.open.side_effect=HTTPError('https://example.dev/api/internal/maintenance',503,'Unavailable',{},BytesIO(json.dumps({'error':{'code':'database_daily_limit','message':'Resets at 00:00 UTC'}}).encode()))
    with patch('ingestion.client.urllib.request.build_opener',return_value=opener),patch('ingestion.client.time.sleep') as sleep:
        with pytest.raises(InternalAPIError,match='00:00 UTC'):
            InternalClient(base='https://example.dev',secret='isolated-client-test-key-32-characters').request('/api/internal/maintenance',{})
        assert opener.open.call_count==1
        sleep.assert_not_called()
