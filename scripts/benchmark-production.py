"""Small, bounded public-query smoke benchmark. No credentials and no private queries."""
import json,time,urllib.request,urllib.error
from datetime import datetime,timezone
from pathlib import Path
BASE='https://therecouldbeanapp.henriquepinheiro.workers.dev'
from urllib.parse import urlencode
stamp=lambda:datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
start=stamp();rows=[]
for case in json.load(open('data/benchmark.json'))['cases'][:60]:
    began=time.monotonic()
    request=urllib.request.Request(BASE+'/api/search?'+urlencode({'q':case['query']}),headers={'User-Agent':'ThereCouldBeAnAppBenchmark/1.0 (+https://therecouldbeanapp.com/about)'})
    try:
        with urllib.request.urlopen(request,timeout=20) as response:
            data=json.load(response);rows.append({'case_id':case['id'],'status':response.status,'wall_ms':(time.monotonic()-began)*1000,'api_elapsed_ms':data['elapsed_ms'],'results':data['total']})
    except urllib.error.HTTPError as error:rows.append({'case_id':case['id'],'status':error.code,'wall_ms':(time.monotonic()-began)*1000})
ordered=sorted(r['wall_ms'] for r in rows)
report={'environment':'deployed Cloudflare Worker and production D1','started_at':start,'completed_at':stamp(),'query_count':len(rows),'http_errors':sum(r['status']!=200 for r in rows),'network_wall_p50_ms':ordered[len(ordered)//2],'network_wall_p95_ms':ordered[int(len(ordered)*.95)],'scope':'60 public benchmark queries, sequential low-volume requests. Network wall time is not Worker CPU. CPU metrics are collected separately from Cloudflare.','cases':rows}
Path('docs/production-search-benchmark.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='cases'},indent=2))
