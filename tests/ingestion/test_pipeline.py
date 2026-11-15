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
