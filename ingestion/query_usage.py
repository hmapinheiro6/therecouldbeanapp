"""Provider-reported request totals, persisted across hosted job steps without private data."""
import json
import os
from pathlib import Path
import re
from .extraction import ROOT

def record(headers):
    if os.environ.get('GITHUB_ACTIONS')!='true':return
    read=headers.get('X-D1-Rows-Read');written=headers.get('X-D1-Rows-Written')
    if read is None or written is None:raise ValueError('Provider query accounting missing from successful private response')
    if not re.fullmatch(r'\d+',str(read)) or not re.fullmatch(r'\d+',str(written)):raise ValueError('Invalid provider query accounting')
    run_id=os.environ['GITHUB_RUN_ID']
    if not re.fullmatch(r'\d+',run_id):raise ValueError('Invalid hosted run identity')
    path=ROOT/'.ingestion-state'/'query-usage'/('run-'+run_id+'.jsonl');path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    value={'rows_read':int(read),'rows_written':int(written)}
    with path.open('a') as stream:stream.write(json.dumps(value)+'\n')
    os.chmod(path,0o600)
    print(json.dumps({'event':'d1_request_usage',**value}))
    check(path)

def check(path=None):
    budgets=json.loads((ROOT/'data/job-budgets.json').read_text())
    job=os.environ.get('GITHUB_WORKFLOW','default');limit=budgets.get(job,budgets['default'])
    path=path or ROOT/'.ingestion-state'/'query-usage'/('run-'+os.environ['GITHUB_RUN_ID']+'.jsonl')
    totals={'rows_read':0,'rows_written':0,'requests':0}
    if path.exists():
        for line in path.read_text().splitlines():
            value=json.loads(line);totals['rows_read']+=value['rows_read'];totals['rows_written']+=value['rows_written'];totals['requests']+=1
    if totals['rows_read']>limit:raise RuntimeError('Hosted job exceeded provider rows-read budget')
    return {**totals,'job':job,'rows_read_budget':limit}

if __name__=='__main__':print(json.dumps(check()))
