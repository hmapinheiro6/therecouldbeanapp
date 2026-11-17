"""Turn a sanitized public snapshot into portable canonical SQL. FTS is rebuilt separately."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from ingestion.seed import emit
p=argparse.ArgumentParser();p.add_argument('snapshot');p.add_argument('--output',required=True);args=p.parse_args()
source=json.loads(Path(args.snapshot).read_text());products=source if isinstance(source,list) else source['products']
normalized=[]
for product in products:
    record=dict(product)
    if 'source' not in record:
        if not record.get('sources'):raise ValueError('Every restored product needs source provenance')
        record['source']=record['sources'][0]
    normalized.append(record)
emit(normalized,args.output)
print('Wrote canonical public records. Apply to a migrated database and rebuild the public static catalog.')
