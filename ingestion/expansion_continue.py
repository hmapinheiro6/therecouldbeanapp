"""Finite hosted continuation, recovered by the existing hourly watchdog."""
import argparse
from datetime import datetime,timezone
import json
from .extraction import ROOT
from .campaign import expansion_priority
from .expansion_artifacts import GitHub


def continue_campaign(github=None,recover=False):
    if not expansion_priority():return False
    path=ROOT/'data/expansion-health.json'
    if not path.exists():return False
    progress=json.loads(path.read_text())
    if progress.get('status')!='running' or not isinstance(progress.get('published_products'),int) or progress['published_products']>=progress['target']:return False
    github=github or GitHub()
    if recover:
        runs=github.api('/actions/workflows/expansion.yml/runs?branch=main&per_page=5')['workflow_runs']
        if any(r['status']!='completed' for r in runs):return False
        if runs and runs[0]['conclusion']!='success':
            print(json.dumps({'expansion_recovery':'needs_attention','last_run':runs[0]['id']}));return False
        checked=datetime.fromisoformat(progress['checked_at'].replace('Z','+00:00'))
        if (datetime.now(timezone.utc)-checked).total_seconds()<40*60:return False
    github.api('/actions/workflows/expansion.yml/dispatches','POST',{'ref':'main','inputs':{'audit':'false','checks':'1000'}})
    print(json.dumps({'expansion_continuation':'dispatched','target':progress['target'],'published_products':progress['published_products'],'deadline':progress['deadline']}))
    return True

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--recover',action='store_true');args=parser.parse_args()
    continue_campaign(recover=args.recover)
