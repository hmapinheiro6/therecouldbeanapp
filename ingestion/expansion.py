"""Resumable hosted campaign. Counts are observations, never promises of publication."""
import argparse
from datetime import datetime,timezone
import json
import os
from .extraction import ROOT,now
from .offline_discovery import save_private,journal_lock,product_urls
from .expansion_artifacts import JOURNAL
from .expansion_sources import collect_sources

CONFIG=ROOT/'data/expansion-campaign.json'
HEALTH=ROOT/'data/expansion-health.json'


def campaign_active(stamp=None):
    config=json.loads(CONFIG.read_text())
    moment=stamp or datetime.now(timezone.utc)
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
        raise ValueError('Publication stage has not been enabled')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--audit',action='store_true');parser.add_argument('--limit',type=int,default=1000);args=parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS')!='true': raise SystemExit('Campaign runs only on GitHub-hosted Actions')
    run(args.audit,args.limit)
