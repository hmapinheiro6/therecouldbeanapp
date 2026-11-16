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

def run(dry_run=False,max_candidates=100,output=None,queue_only=False):
    max_candidates=min(max_candidates,100);client=None if dry_run else InternalClient()
    state=client.request('/api/internal/pending') if client else {'submissions':[],'candidates':[],'checkpoints':[]}
    checkpoints={p['source_name']:p['cursor_value'] for p in state['checkpoints']}
    run_id=str(uuid.uuid4());started=now()
    summary={'id':run_id,'source_name':'pending-verification' if queue_only else 'daily-discovery','started_at':started,'completed_at':None,'status':'running','candidates_found':0,'records_accepted':0,'records_rejected':0,'records_pending':0,'error_summary':None}
    if client:client.request('/api/internal/ingest',{'run':summary})
    try:
        candidates=[];errors=[];new_checkpoints=[]
        for s in [x for x in state['submissions'] if x['status'] in ('pending','approved')][:min(10,max_candidates)]:
            candidates.append({'name':s['product_name'],'canonical_url':s['submitted_url'],'source_name':'Submissions','source_type':'submission','source_url':s['submitted_url'],'external_id':s['id'],'submission_id':s['id'],'discovered_at':s['created_at']})
        for c in [x for x in state['candidates'] if x['status']=='pending_verification'][:min(10,max(0,max_candidates-len(candidates)))]:
            c=dict(c);c['source_type']={'Hacker News':'hackernews','GitHub':'github','Submissions':'submission'}.get(c['source_name'],'feed');c['discovered_at']=c['created_at'];c['resolve_identity']=c['source_name'] in ('Hacker News','GitHub');candidates.append(c)
        sources=Sources(SafeWeb(delay=.25))
        # Independent quotas prevent one busy source from starving all others.
        adapters=[] if queue_only else [('hackernews_newest',sources.hackernews),
                  *[(f'github_{topic}',lambda checkpoint,limit,topic=topic:sources.github(checkpoint,limit,topic)) for topic in ('saas','productivity','developer-tools')]]
        for source_index,(name,fetch) in enumerate(adapters):
            try:
                if len(candidates)>=max_candidates:break
                remaining=max_candidates-len(candidates)
                quota=max(1,int(remaining*.6)) if source_index==0 else max(1,remaining//(len(adapters)-source_index))
                items,cursor=fetch(checkpoints.get(name),limit=min(60,quota))
                candidates.extend(items)
                if cursor:new_checkpoints.append({'source_name':name,'cursor_value':cursor})
            except (ValueError,FetchError) as e:errors.append(name+': '+str(e)[:160])
        for feed in ([] if queue_only else json.loads((ROOT/'data/feeds.json').read_text())):
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
                if c['source_name']=='Homebrew Cask (BSD-2-Clause)' or c['source_name']=='Awesome-Selfhosted (CC-BY-SA-3.0)':
                    from .backfill import verify_identity
                    draft=json.loads(c.get('review_draft_json') or '{}')
                    c['name']=draft.get('name',c['name']);c['canonical_url']=draft.get('canonical_url',c['canonical_url']);c['aliases']=[c['name']]
                    c['licensed_description']=draft.get('short_description',c['name']).removeprefix(c['name']+': ')
                    c['category_slug']=draft.get('category_slug','desktop-apps')
                    p=verify_identity(c)
                else:p=verify(c,web)
                if queue_only:
                    record=queue_record(c,'needs_review','Official evidence prepared; review every claim before publication.')
                    p.setdefault('verification_scope','capabilities')
                    record['review_draft_json']=json.dumps(p)
                    if len(record['review_draft_json'])>12000:raise ValueError('Review draft exceeds the editorial API limit')
                    summary['records_pending']+=1
                    if client:client.request('/api/internal/ingest',{'candidates':[record]})
                else:
                    products.append(p);record=queue_record(c,'published');summary['records_accepted']+=1
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
    except Exception as error:
        summary.update(completed_at=now(),status='failed',error_summary=type(error).__name__+': '+str(error)[:180])
        if client:
            try:client.request('/api/internal/ingest',{'run':summary})
            except Exception:print('Could not persist final failure status; inspect the interrupted run.',file=sys.stderr)
        raise

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');parser.add_argument('--max-candidates',type=int,default=100);parser.add_argument('--output');parser.add_argument('--queue-only',action='store_true');args=parser.parse_args()
    if args.max_candidates<1:parser.error('max-candidates must be positive')
    try:sys.exit(run(args.dry_run,args.max_candidates,args.output,args.queue_only))
    except Exception as e:
        # Deliberately omit data, credentials, and tracebacks in unattended logs.
        print(json.dumps({'status':'failed','kind':type(e).__name__,'message':str(e)[:200]}),file=sys.stderr);sys.exit(1)
if __name__=='__main__':main()
