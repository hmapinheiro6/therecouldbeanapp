"""Verify curated candidates live, then emit portable public records and parameter-quoted SQL."""
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from .safe_web import SafeWeb
from .extraction import ROOT,verify,now

def sql(value):return 'NULL' if value is None else "'"+str(value).replace("'","''")+"'"
def emit(products,path):
    lines=['-- Sanitized public facts only. Generated from verified official pages.','PRAGMA foreign_keys=ON;']
    for category in json.loads((ROOT/'data/categories.json').read_text()):
        lines.append('INSERT OR IGNORE INTO categories(slug,name,description) VALUES('+','.join(sql(category[k]) for k in ('slug','name','description'))+');')
    for cap in json.loads((ROOT/'data/capabilities.json').read_text()):
        lines.append('INSERT OR IGNORE INTO capabilities(slug,name,description) VALUES('+','.join(sql(cap[k]) for k in ('slug','name','description'))+');')
    for p in products:
        domain=p['canonical_url'].split('/')[2]
        lines.append('INSERT OR IGNORE INTO products(slug,name,canonical_url,normalized_domain,short_description,category_id,audience,status,first_seen_at,last_verified_at) VALUES('+','.join(sql(p[k]) for k in ('slug','name','canonical_url'))+','+sql(domain)+','+sql(p['short_description'])+', (SELECT id FROM categories WHERE slug='+sql(p['category_slug'])+'),'+sql(p['audience'])+",'published',"+sql(p['first_seen_at'])+','+sql(p['last_verified_at'])+');')
        lines.append('UPDATE products SET verification_scope='+sql(p.get('verification_scope','capabilities'))+',identity_evidence_url='+sql(p.get('identity_evidence_url'))+',identity_evidence_text='+sql(p.get('identity_evidence_text'))+' WHERE canonical_url='+sql(p['canonical_url'])+';')
        for c in p['capabilities']:
            lines.append('INSERT OR REPLACE INTO product_capabilities(product_id,capability_id,evidence_url,evidence_text,confidence_class,verified_at) VALUES((SELECT id FROM products WHERE canonical_url='+sql(p['canonical_url'])+'),(SELECT id FROM capabilities WHERE slug='+sql(c['slug'])+'),'+sql(c['evidence_url'])+','+sql(c['evidence_text'])+",'verified',"+sql(c['verified_at'])+');')
        s=p['source']
        lines.append('INSERT OR IGNORE INTO product_sources(product_id,source_type,source_name,source_url,external_id,discovered_at) VALUES((SELECT id FROM products WHERE canonical_url='+sql(p['canonical_url'])+'),'+','.join(sql(s[k]) for k in ('source_type','source_name','source_url','external_id','discovered_at'))+');')
    Path(path).write_text('\n'.join(lines)+'\n')

def main():
    candidates=json.loads((ROOT/'data/seeds/candidates.json').read_text());products=[];failures=[]
    def check(c):
        try:return verify(c,SafeWeb(delay=.3),curated=True),None
        except Exception as e:return None,{'name':c['name'],'url':c['canonical_url'],'reason':str(e),'checked_at':now()}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(check,c):c for c in candidates}
        for future in as_completed(futures):
            p,f=future.result()
            if p:products.append(p);print('Verified:',p['name'],','.join(c['slug'] for c in p['capabilities']),flush=True)
            else:failures.append(f);print('Pending:',f['name'],f['reason'],flush=True)
    products.sort(key=lambda p:p['name'].lower())
    (ROOT/'data/seeds/catalog.json').write_text(json.dumps(products,indent=2)+'\n')
    (ROOT/'data/seeds/verification-report.json').write_text(json.dumps({'checked_at':now(),'accepted':len(products),'pending':failures},indent=2)+'\n')
    emit(products,ROOT/'data/seeds/catalog.sql')
    print('Published seed records:',len(products))
if __name__=='__main__':main()
