"""Short publication lease prevents a stale build from undoing an urgent removal."""
import argparse
import json
import os
from .client import InternalClient
from .extraction import ROOT

PATH=ROOT/'.ingestion-state/publication-lease.json'
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('stage',choices=['acquire','release']);stage=parser.parse_args().stage
    client=InternalClient()
    if stage=='acquire':
        snapshot=json.loads((ROOT/'data/seeds/published-snapshot.json').read_text())
        result=client.request('/api/internal/publication-lease',{'action':'acquire','revision':snapshot['publication_revision']})
        PATH.parent.mkdir(parents=True,exist_ok=True,mode=0o700);PATH.write_text(json.dumps(result));os.chmod(PATH,0o600)
        print('Matching catalog revision locked for deployment.')
    else:
        if PATH.exists():
            value=json.loads(PATH.read_text());client.request('/api/internal/publication-lease',{'action':'release','token':value['token']});PATH.unlink()
        print('Publication lease released.')

if __name__=='__main__':main()
