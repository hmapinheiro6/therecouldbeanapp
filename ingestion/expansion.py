"""Resumable hosted campaign. Counts are observations, never promises of publication."""
import argparse
from datetime import datetime,timezone
import json
import os
from concurrent.futures import ThreadPoolExecutor,as_completed
import re
import threading
import time
from urllib.parse import urlsplit,urljoin
from .safe_web import SafeWeb,FetchError,canonicalize
from .extraction import Metadata
from .backfill import verify_identity
from .client import InternalClient,InternalAPIError
from .extraction import ROOT,now
from .offline_discovery import save_private,journal_lock,product_urls
from .expansion_artifacts import JOURNAL
from .expansion_sources import collect_sources,third_party_homepage

CONFIG=ROOT/'data/expansion-campaign.json'
HEALTH=ROOT/'data/expansion-health.json'


def campaign_active(stamp=None):
    config=json.loads(CONFIG.read_text())
    moment=stamp or datetime.now(timezone.utc)
    if config.get('mode') == 'continuous': return bool(config.get('enabled'))
    return bool(config['enabled'] and moment < datetime.fromisoformat(config['deadline'].replace('Z','+00:00')))


def bootstrap(state):
    if state.get('sources_loaded'): return
    candidates,counts,errors=collect_sources()
    snapshot=json.loads((ROOT/'data/seeds/published-snapshot.json').read_text())
    known=product_urls(snapshot)
    state['records']=[{'candidate':c,'status':'pending'} for c in candidates if c['canonical_url'] not in known]
    state['source_counts']=counts;state['source_errors']=errors
    state['sources_loaded']=True;state['loaded_at']=now()
    save_private(JOURNAL,state)


def health(state,status,published=None):
    config=json.loads(CONFIG.read_text())
    value={'campaign':config['id'],'target':config['target'],'deadline':config['deadline'],'checked_at':now(),'status':status,
        'published_products':published,'source_candidates':state.get('source_counts',{}),'source_errors':state.get('source_errors',{}),
        'remaining_candidates':sum(r['status']=='pending' for r in state['records']),
        'held':sum(r['status']=='held' for r in state['records']), 'published_by_campaign':state.get('published_by_campaign',0),
        'checked_total':state.get('checked_total',0),'publication_rows_written':state.get('observed_rows_written',0),
        'execution':'github-hosted','workflow_url':'https://github.com/'+os.environ.get('GITHUB_REPOSITORY','hmapinheiro6/therecouldbeanapp')+'/actions/runs/'+os.environ.get('GITHUB_RUN_ID','unknown')}
    HEALTH.write_text(json.dumps(value,indent=2)+'\n')
    print(json.dumps(value))
    return value


def run(audit=False,limit=1000):
    if not 1<=limit<=1000: raise ValueError('Use 1–1000 checks')
    with journal_lock(JOURNAL):
        state=json.loads(JOURNAL.read_text()) if JOURNAL.exists() else {'version':1,'records':[],'runs':[],'published_by_campaign':0}
        if not campaign_active(): return health(state,'deadline_reached')
        bootstrap(state)
        if audit: return health(state,'sources_audited')
        return publish(state,limit)


def verify_candidate(candidate,web=None):
    web=web or SafeWeb(delay=.75,max_pages=1,max_bytes=1024*1024)
    if third_party_homepage(urlsplit(candidate['canonical_url']).hostname):raise ValueError('Directory is not an official publisher homepage')
    page=web.fetch(candidate['canonical_url'])
    if page['status']!=200 or 'html' not in page.get('content_type','').lower(): raise ValueError('Official website unavailable')
    if third_party_homepage(urlsplit(page['url']).hostname):raise ValueError('Redirected to a third-party download directory')
    if urlsplit(canonicalize(page['url'])).hostname != urlsplit(candidate['canonical_url']).hostname: raise ValueError('Cross-host identity needs review')
    parser=Metadata();parser.feed(page['text'])
    title=' '.join([parser.title,parser.meta.get('og:title',''),parser.meta.get('og:site_name','')])
    compact=lambda v: re.sub(r'[^a-z0-9]','',v.casefold())
    generic={'app','client','desktop','portable','install','installer','setup','windows','macos','linux','win32','win64','x64','x86','arm64','stable','community','enterprise','professional','pro','free','trial'}
    aliases=[alias for alias in candidate['aliases'] if compact(alias) not in generic and not compact(alias).isdigit()]
    matched=any((len(compact(alias))>=4 and compact(alias) in compact(title)) or (len(compact(alias))>=2 and re.search(r'(?<!\w)'+re.escape(alias)+r'(?!\w)',title,re.I)) for alias in aliases)
    if not matched or re.search(r'\b(domain for sale|buy this domain|page not found|just a moment|access denied|attention required|verify you are human)\b',title,re.I): raise ValueError('Official title did not establish product identity')
    resolved_url=canonicalize(page['url'])
    hint=parser.canonical or parser.meta.get('og:url')
    if hint:
        try:
            hinted=canonicalize(urljoin(page['url'],hint))
            if urlsplit(hinted).hostname==urlsplit(resolved_url).hostname: resolved_url=hinted
        except ValueError: pass
    if urlsplit(resolved_url).hostname=='github.com':
        parts=urlsplit(resolved_url).path.strip('/').split('/')
        if len(parts)<2 or len(parts)>2 and parts[2] not in ('releases','tree','wiki'): raise ValueError('Not a repository product page')
        resolved_url='https://github.com/'+'/'.join(parts[:2])
    resolved={**candidate,'canonical_url':resolved_url}
    product=verify_identity(resolved,page)
    product['identity_evidence_url']=canonicalize(page['url'])
    return product


def identity_key(name):
    return re.sub(r'[^a-z0-9]','',name.casefold())


def refresh_identities(state,client):
    identities=state.setdefault('identity_index',[]);after=state.get('identity_after',0)
    for _ in range(25):
        page=client.request('/api/internal/identity-index?after='+str(after))
        for product in page['products']:
            identities.append(product);after=max(after,product['id'])
        following=page['next_after']
        if following is None:break
        if following<=state.get('identity_after',0):raise ValueError('Identity cursor did not advance')
        state['identity_after']=after
    else:raise ValueError('Identity index exceeds campaign bound')
    state['identity_after']=after
    # Conservative check for NEW candidates only. Existing published identities
    # remain unchanged; matching names across URLs can also be distinct products.
    names={}
    for product in identities:
        key=identity_key(product['name'])
        if len(key)>=2:names.setdefault(key,set()).add(product['canonical_url'])
    return names


def publish(state,limit,client=None,verify=verify_candidate):
    client=client or InternalClient()
    client.request('/api/internal/maintenance',{})
    identities=refresh_identities(state,client)
    status=client.request('/api/internal/expansion-status');published=int(status['published'])
    config=json.loads(CONFIG.read_text());target=config['target']
    if published>=target: return health(state,'target_reached',published)
    start=time.monotonic();deadline=start+25*60;checked=0
    def persist(): save_private(JOURNAL,state)
    def active(): return campaign_active() and time.monotonic()<=deadline
    def deliver(batch):
        nonlocal published
        try:
            result=client.request('/api/internal/ingest',{'expansion':config['id'] if config.get('mode')=='continuous' else '2026-11-17','products':[r['product'] for r in batch]})
        except InternalAPIError as error:
            if error.status not in (400,422): raise
            if len(batch)>1:
                for record in batch:
                    if active() and published<target: deliver([record])
                return
            batch[0].update(status='held',reason='publication_policy_rejected');persist();return
        if result.get('status')=='target_reached': published=target;return
        if result.get('status')!='accepted': raise ValueError('Campaign write was not acknowledged')
        accepted=int(result['products'])
        if not 0<=accepted<=len(batch): raise ValueError('Invalid publication acknowledgement')
        state['published_by_campaign']=state.get('published_by_campaign',0)+accepted
        published=int(result.get('catalog_total',published+accepted))
        for record in batch:
            record['status']='published'
            if record['product'].get('name'):identities.setdefault(identity_key(record['product']['name']),set()).add(record['product']['canonical_url'])
        accounting=result.get('accounting',{})
        state['observed_rows_written']=state.get('observed_rows_written',0)+accounting.get('rows_written',0)
        state['observed_rows_read']=state.get('observed_rows_read',0)+accounting.get('rows_read',0)
        persist()
        # Provider statement accounting excludes nonce/reservation overhead. Stop
        # automatically if product writes exceed the measured sixteen-row allowance.
        if accepted and accounting.get('rows_written',0)>accepted*16:
            raise RuntimeError('Measured publication cost exceeds campaign allowance')
    def flush():
        nonlocal published
        ready=[r for r in state['records'] if r['status']=='ready'][:20]
        if not ready: return
        known=set(client.request('/api/internal/known',{'urls':[r['product']['canonical_url'] for r in ready]})['known'])
        unique={};batch_names={}
        for record in ready:
            url=record['product']['canonical_url']
            names=[record['product'].get('name',''),*record.get('candidate',{}).get('aliases',[])]
            if any((identities.get(identity_key(name),set()) | batch_names.get(identity_key(name),set()))-{url} for name in names if len(identity_key(name))>=2):
                record.update(status='held',reason='name_identity_needs_review');continue
            if url in known or url in unique: record['status']='duplicate'
            else:
                unique[url]=record
                for name in names:
                    if len(identity_key(name))>=2:batch_names.setdefault(identity_key(name),set()).add(url)
        batch=list(unique.values())[:max(0,target-published)]
        if batch and active(): deliver(batch)
        state['records']=[r for r in state['records'] if r['status'] not in ('published','duplicate')]
        persist()
    try:
        while any(r['status']=='ready' for r in state['records']) and published<target and active(): flush()
        pending=[r for r in state['records'] if r['status']=='pending'][:limit]
        locks={urlsplit(r['candidate']['canonical_url']).hostname:threading.Lock() for r in pending}
        def check(record):
            if not active() or published>=target: return record,None,'not_started'
            with locks[urlsplit(record['candidate']['canonical_url']).hostname]:
                if not active() or published>=target: return record,None,'not_started'
                try: return record,verify(record['candidate']),None
                except (ValueError,FetchError,OSError,KeyError,TypeError,UnicodeError,RecursionError): return record,None,'official_identity_unconfirmed'
        # Filter known/blocked source URLs before making official-site requests.
        selected=[]
        for offset in range(0,len(pending),30):
            group=pending[offset:offset+30]
            known=set(client.request('/api/internal/known',{'urls':[r['candidate']['canonical_url'] for r in group]})['known'])
            for r in group:
                url=r['candidate']['canonical_url']
                names=[r['candidate'].get('name',''),*r['candidate'].get('aliases',[])]
                if url in known: r['status']='duplicate'
                elif any(identities.get(identity_key(name),set())-{url} for name in names if len(identity_key(name))>=2):r.update(status='held',reason='name_identity_needs_review')
                else: selected.append(r)
        state['records']=[r for r in state['records'] if r['status']!='duplicate'];persist()
        with ThreadPoolExecutor(max_workers=8) as pool:
            for future in as_completed([pool.submit(check,r) for r in selected]):
                record,product,error=future.result()
                if error=='not_started': continue
                checked+=1
                if product: record.update(status='ready',product=product)
                else: record.update(status='held',reason=error)
                if sum(r['status']=='ready' for r in state['records'])>=20 and published<target and active(): flush()
                if checked%25==0: persist()
        while any(r['status']=='ready' for r in state['records']) and published<target and active(): flush()
        state['last_checked']=checked;state['checked_total']=state.get('checked_total',0)+checked;persist()
        outcome='deadline_reached' if not campaign_active() else 'target_reached' if published>=target else 'source_exhausted' if not any(r['status']=='pending' for r in state['records']) else 'running'
        return health(state,outcome,published)
    except Exception as error:
        state['last_checked']=checked;state['checked_total']=state.get('checked_total',0)+checked
        persist()
        if isinstance(error,InternalAPIError) and (error.status,error.code) in ((429,'ingestion_daily_budget'),(503,'database_daily_limit')):
            state['last_failure']=error.code;persist();return health(state,'quota_deferred',published)
        # Preserve ready products for retry; never convert failures to published.
        # Publish current aggregate progress even when the hosted run fails.
        health(state,'failed',published)
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--audit',action='store_true');parser.add_argument('--limit',type=int,default=1000);args=parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS')!='true': raise SystemExit('Campaign runs only on GitHub-hosted Actions')
    run(args.audit,args.limit)
