"""python -m ingestion.run [--dry-run]; max 100 candidates; cloud scheduler is the operator."""
import argparse
import hashlib
import json
import re
import sys
import uuid
from datetime import datetime,timedelta,timezone
from pathlib import Path
from .safe_web import SafeWeb,FetchError,canonicalize
from .extraction import verify,now,ROOT
from .sources import Sources,parse_feed
from .client import InternalClient

def identity(candidate):return hashlib.sha256((candidate['source_name']+':'+candidate['external_id']).encode()).hexdigest()
def queue_record(c,status,reason=None):
    attempts=c.get('attempts',0)+1
    return {'id':c.get('id',identity(c)),'source_name':c['source_name'],'source_url':c['source_url'],'external_id':c['external_id'],'name':c['name'][:100],'canonical_url':canonicalize(c['canonical_url']),'status':status,'reason':reason[:500] if reason else None,'attempts':attempts,'next_retry_at':(datetime.now(timezone.utc)+timedelta(days=min(7,2**attempts))).isoformat().replace('+00:00','Z') if status=='pending_verification' else None,'submission_id':c.get('submission_id'),'created_at':c.get('created_at',now()),'updated_at':now()}

def run(dry_run=False,max_candidates=100,output=None):
    max_candidates=min(max_candidates,100);client=None if dry_run else InternalClient()
    state=client.request('/api/internal/pending') if client else {'submissions':[],'candidates':[],'checkpoints':[]}
    checkpoints={p['source_name']:p['cursor_value'] for p in state['checkpoints']}
    run_id=str(uuid.uuid4());started=now()
    summary={'id':run_id,'source_name':'daily-discovery','started_at':started,'completed_at':None,'status':'running','candidates_found':0,'records_accepted':0,'records_rejected':0,'records_pending':0,'error_summary':None}
    if client:client.request('/api/internal/ingest',{'run':summary})
    candidates=[];errors=[];new_checkpoints=[]
    for s in [x for x in state['submissions'] if x['status'] in ('pending','approved')][:10]:
        candidates.append({'name':s['product_name'],'canonical_url':s['submitted_url'],'source_name':'Submissions','source_type':'submission','source_url':s['submitted_url'],'external_id':s['id'],'submission_id':s['id'],'discovered_at':s['created_at']})
    for c in [x for x in state['candidates'] if x['status']=='pending_verification'][:20]:
        c=dict(c);c['source_type']={'Hacker News':'hackernews','GitHub':'github','Submissions':'submission'}.get(c['source_name'],'feed');c['discovered_at']=c['created_at'];candidates.append(c)
    sources=Sources(SafeWeb(delay=.25))
    for name,fetch in [('hackernews',sources.hackernews),('github',sources.github)]:
        try:
            if len(candidates)>=max_candidates:break
            items,cursor=fetch(checkpoints.get(name),limit=min(30,max_candidates-len(candidates)))
            candidates.extend(items)
            if cursor:new_checkpoints.append({'source_name':name,'cursor_value':cursor})
        except (ValueError,FetchError) as e:errors.append(name+': '+str(e)[:160])
    for feed in json.loads((ROOT/'data/feeds.json').read_text()):
        if not feed['enabled']:continue
        if not feed.get('permission_cleared_at'):raise RuntimeError('Enabled feed lacks a permission review')
        try:
            page=SafeWeb().fetch(feed['url'])
            items=parse_feed(page['text'],feed['kind'])
            for c in items[:max(0,max_candidates-len(candidates))]:c.update(source_name=feed['name'],source_type='feed',source_url=feed['url'],discovered_at=now());candidates.append(c)
        except (ValueError,FetchError) as e:errors.append(feed['name']+': '+str(e)[:160])
    seen=set();deduped=[]
    for c in candidates:
        key=identity(c)
        if key not in seen:deduped.append(c);seen.add(key)
    candidates=deduped[:max_candidates];summary['candidates_found']=len(candidates)
    products=[];records=[];web=SafeWeb(delay=.5)
    for c in candidates:
        try:
            p=verify(c,web);products.append(p);record=queue_record(c,'published');summary['records_accepted']+=1
            if client:client.request('/api/internal/ingest',{'products':[p],'candidates':[record]})
        except (ValueError,FetchError) as e:
            temporary=isinstance(e,FetchError) and e.temporary
            status='pending_verification' if temporary else 'needs_review'
            if isinstance(e,ValueError) and not isinstance(e,FetchError):status='rejected'
            record=queue_record(c,status,str(e));summary['records_rejected' if status=='rejected' else 'records_pending']+=1
            if client:client.request('/api/internal/ingest',{'candidates':[record]})
        records.append(record)
    summary.update(completed_at=now(),status='partial' if errors else 'success',error_summary='; '.join(errors)[:500] or None)
    if client:client.request('/api/internal/ingest',{'run':summary,'checkpoints':new_checkpoints if not errors else []})
    # Dry-run output contains public product data and public discovery candidates only; no submission PII.
    if output:Path(output).write_text(json.dumps({'run':summary,'products':products,'candidates':[{k:v for k,v in r.items() if k!='submission_id'} for r in records if r['source_name']!='Submissions']},indent=2))
    print(json.dumps({'dry_run':dry_run,'run':summary},indent=2))
    return 1 if errors else 0

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');parser.add_argument('--max-candidates',type=int,default=100);parser.add_argument('--output');args=parser.parse_args()
    if args.max_candidates<1:parser.error('max-candidates must be positive')
    try:sys.exit(run(args.dry_run,args.max_candidates,args.output))
    except Exception as e:
        # Deliberately omit data, credentials, and tracebacks in unattended logs.
        print(json.dumps({'status':'failed','kind':type(e).__name__,'message':str(e)[:200]}),file=sys.stderr);sys.exit(1)
if __name__=='__main__':main()
