"""Cloud backfill from licensed Homebrew metadata; official identity is checked, features remain unverified."""
import argparse,json,hashlib,re,uuid,threading,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from .safe_web import SafeWeb,FetchError,canonicalize
from .extraction import Metadata,now
from .client import InternalClient
from .run import queue_record
SOURCE='https://formulae.brew.sh/api/cask.json'

def candidates_from(rows):
    out=[];seen=set()
    for row in rows:
        if row.get('disabled') or row.get('deprecated') or '@' in row.get('token','') or row.get('token','').startswith('font-'):continue
        if not any(isinstance(a,dict) and 'app' in a for a in row.get('artifacts',[])):continue
        names=row.get('name',[]);description=row.get('desc','')
        if not names or not description or not row.get('homepage') or len(names[0])<2:continue
        try:url=canonicalize(row['homepage'])
        except ValueError:continue
        if url in seen:continue
        seen.add(url)
        out.append({'name':re.sub(r'[<>]','',names[0])[:100],'aliases':names,'canonical_url':url,'source_name':'Homebrew Cask (BSD-2-Clause)','source_type':'feed','source_url':'https://formulae.brew.sh/cask/'+row['token'],'external_id':row['token'],'discovered_at':now(),'licensed_description':description})
    return sorted(out,key=lambda c:hashlib.sha256(c['external_id'].encode()).hexdigest())

def verify_identity(c):
    # Each worker gets its own fetcher. Robots, redirects, public DNS and TLS checks
    # are unchanged. Each canonical hostname is handled by only one worker below.
    page=SafeWeb(delay=.5).fetch(c['canonical_url'])
    if page['status']!=200 or 'html' not in page['content_type']:raise FetchError('No usable official product page',False)
    p=Metadata();p.feed(page['text']);sentences=p.sentences();text=' '.join(sentences)
    if len(text)<80:raise FetchError('Insufficient official identity evidence',False)
    normalized=re.sub(r'[^a-z0-9]','',text.casefold())
    def matches(name):
        compact=re.sub(r'[^a-z0-9]','',name.casefold())
        return len(compact)>=4 and compact in normalized or len(compact)>=2 and re.search(r'\b'+re.escape(name)+r'\b',p.title,re.I)
    if not any(matches(n) for n in c['aliases']):raise FetchError('Official page did not confirm the directory product name',False)
    title=re.sub(r'\s+',' ',p.title).strip() or next((s for s in sentences if c['name'].lower() in s.lower()),'')
    title=re.sub(r'[<>]','',title)[:600]
    if len(title)<2:raise FetchError('Official identity excerpt unavailable',False)
    description=c['name']+': '+c['licensed_description'].strip().rstrip('.')+'.'
    if len(description)<20:description+=' Desktop application.'
    description=re.sub(r'[<>]','',description)[:600]
    stamp=now();slug=re.sub(r'[^a-z0-9]+','-',c['name'].lower()).strip('-')[:75] or 'app'
    return {'slug':slug+'-'+hashlib.sha256(c['canonical_url'].encode()).hexdigest()[:8],'name':re.sub(r'[<>]','',c['name']),'canonical_url':c['canonical_url'],'short_description':description,'category_slug':'desktop-apps','audience':'Desktop software users','search_aliases':re.sub(r'[<>]','',' '.join(c['aliases']))[:300],'first_seen_at':stamp,'announced_at':None,'last_verified_at':stamp,'verification_scope':'identity','identity_evidence_url':c['canonical_url'],'identity_evidence_text':title,'capabilities':[],'source':{k:c[k] for k in ['source_type','source_name','source_url','external_id','discovered_at']}}

def run(max_candidates=500,workers=8,dry_run=False):
    client=None if dry_run else InternalClient();started=now();run_id=str(uuid.uuid4())
    summary={'id':run_id,'source_name':'homebrew-backfill','started_at':started,'completed_at':None,'status':'running','candidates_found':0,'records_accepted':0,'records_rejected':0,'records_pending':0,'error_summary':None}
    if client:client.request('/api/internal/ingest',{'run':summary})
    try:
        raw=SafeWeb(delay=.5,max_bytes=32*1024*1024).fetch(SOURCE)
        candidates=candidates_from(json.loads(raw['text']));available=len(candidates);known=set()
        if client:
            for i in range(0,len(candidates),30):known.update(client.request('/api/internal/known',{'urls':[c['canonical_url'] for c in candidates[i:i+30]]})['known'])
        candidates=[c for c in candidates if c['canonical_url'] not in known][:max_candidates];summary['candidates_found']=len(candidates)
        # Group by origin so simultaneous products never hit the same origin.
        from urllib.parse import urlsplit
        locks={urlsplit(c['canonical_url']).hostname:threading.Lock() for c in candidates}
        def check(c):
            with locks[urlsplit(c['canonical_url']).hostname]:
                try:return c,verify_identity(c),None
                except (ValueError,FetchError) as e:return c,None,e
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures=[pool.submit(check,c) for c in candidates];done=0
            for future in as_completed(futures):
                c,p,error=future.result();done+=1
                if p:
                    summary['records_accepted']+=1;record=queue_record(c,'published')
                    if client:client.request('/api/internal/ingest',{'products':[p],'candidates':[record]})
                else:
                    summary['records_pending']+=1;record=queue_record(c,'pending_verification' if isinstance(error,FetchError) and error.temporary else 'needs_review',str(error))
                    record['review_draft_json']=json.dumps({'name':c['name'],'canonical_url':c['canonical_url'],'short_description':c['name']+': '+c['licensed_description'],'category_slug':'desktop-apps','capabilities':[],'verification_scope':'identity'})
                    if client:client.request('/api/internal/ingest',{'candidates':[record]})
                if done%50==0:print(json.dumps({'processed':done,'published':summary['records_accepted'],'pending':summary['records_pending']}),flush=True)
        summary.update(completed_at=now(),status='success')
        if client:client.request('/api/internal/ingest',{'run':summary})
        print(json.dumps({'dry_run':dry_run,'directory_candidates':available,'already_seen':len(known),'run':summary},indent=2),flush=True)
    except Exception as e:
        summary.update(completed_at=now(),status='failed',error_summary=type(e).__name__+': '+str(e)[:200])
        if client:client.request('/api/internal/ingest',{'run':summary})
        raise
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--max-candidates',type=int,default=500);parser.add_argument('--workers',type=int,default=8);parser.add_argument('--dry-run',action='store_true');args=parser.parse_args()
    if not 1<=args.max_candidates<=2000 or not 1<=args.workers<=12:parser.error('Use 1–2000 candidates and 1–12 workers')
    run(args.max_candidates,args.workers,args.dry_run)
