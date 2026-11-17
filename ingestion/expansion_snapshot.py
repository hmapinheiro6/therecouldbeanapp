"""Refresh the public build input from authenticated, keyset-paged published data."""
import json
from .client import InternalClient
from .extraction import ROOT,now
from .safe_web import canonicalize

TARGET=ROOT/'data/seeds/published-snapshot.json'
FIELDS=('slug','name','canonical_url','short_description','category_slug','audience','search_aliases','first_seen_at','announced_at','last_verified_at','verification_scope','identity_evidence_url','identity_evidence_text','capabilities','sources')

def refresh(client=None):
    progress=json.loads((ROOT/'data/expansion-health.json').read_text())
    if progress.get('status')=='sources_audited': return
    previous=json.loads(TARGET.read_text());reported=progress.get('published_products')
    final=progress.get('status') in ('target_reached','source_exhausted','deadline_reached')
    if not isinstance(reported,int) or reported<=len(previous['products']) or not final and reported-len(previous['products'])<2000:return
    client=client or InternalClient();products=[];public=[];after=0;seen=set()
    for _ in range(241):
        page=client.request('/api/internal/snapshot?after='+str(after))
        for row in page['products']:
            url=canonicalize(row['canonical_url'])
            if url in seen or not row['sources'] or row['verification_scope'] not in ('identity','capabilities'):raise ValueError('Invalid published snapshot identity/provenance')
            seen.add(url)
            p={k:row[k] for k in FIELDS}
            p['url_aliases']=row.get('url_aliases',[])
            products.append(p);public.append({**p,'id':row['id'],'category':row['category'],'normalized_domain':row['normalized_domain']})
        following=page['next_after']
        if following is None:break
        if not isinstance(following,int) or following<=after:raise ValueError('Snapshot cursor did not advance')
        after=following
    else:raise ValueError('Snapshot exceeds 12000-product bound')
    if len(products)<reported or len(products)<len(previous['products'])*.9:raise ValueError('Incomplete published export; previous snapshot preserved')
    value=json.dumps({'exported_at':now(),'environment':'production','products':products},indent=2)+'\n'
    if len(value.encode())>24*1024*1024:raise ValueError('Snapshot exceeds free asset size allowance')
    temporary=TARGET.with_suffix('.pending.local');temporary.write_text(value);temporary.replace(TARGET)
    print(json.dumps({'public_snapshot_products':len(products),'method':'authenticated_keyset_export'}))

if __name__=='__main__':refresh()
