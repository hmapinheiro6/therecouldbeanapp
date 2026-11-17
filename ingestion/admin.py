"""Authenticated operator CLI. Use environment variables; never pass a secret in arguments."""
import argparse
import json
from pathlib import Path
from .client import InternalClient
from .extraction import ROOT,now

def main():
    p=argparse.ArgumentParser();s=p.add_subparsers(dest='command',required=True)
    pending=s.add_parser('pending');pending.add_argument('--after',default='')
    for action in ('approve','reject','retry','remove'):
        a=s.add_parser(action);a.add_argument('kind',choices=['submission','candidate','product']);a.add_argument('id');a.add_argument('--reason',required=True)
    snapshot=s.add_parser('snapshot');snapshot.add_argument('--output',required=True)
    s.add_parser('import-seed')
    args=p.parse_args();client=InternalClient()
    if args.command=='pending':
        from urllib.parse import quote
        print(json.dumps(client.request('/api/internal/pending?after='+quote(args.after)),indent=2))
    elif args.command=='snapshot':
        products=[];after=0
        for _ in range(241):
            page=client.request('/api/internal/snapshot?after='+str(after));products.extend(page['products'])
            if page['next_after'] is None:break
            after=page['next_after']
        else:raise RuntimeError('Snapshot exceeded 12000 products; use partitioned export')
        Path(args.output).write_text(json.dumps({'exported_at':now(),'products':products},indent=2)+'\n');print('Exported '+str(len(products))+' public products')
    elif args.command=='import-seed':
        products=json.loads((ROOT/'data/seeds/catalog.json').read_text())
        for i in range(0,len(products),5):client.request('/api/internal/ingest',{'products':products[i:i+5]})
        print('Imported '+str(len(products))+' verified seed products (idempotent)')
    else:
        print(json.dumps(client.request('/api/internal/moderate',{'kind':args.kind,'id':args.id,'action':args.command,'reason':args.reason}),indent=2))
if __name__=='__main__':main()
