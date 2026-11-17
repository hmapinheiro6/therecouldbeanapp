"""Weekly real repository update to keep public Actions schedules enabled."""
import base64
from datetime import datetime, timezone
import json
import os
import urllib.request
from .client import NoRedirect

def main():
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REPOSITORY')!='hmapinheiro6/therecouldbeanapp':
        raise ValueError('Use the trusted heartbeat workflow')
    url='https://api.github.com/repos/hmapinheiro6/therecouldbeanapp/contents/data/repository-heartbeat.json'
    headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'User-Agent':'tcba-repository-heartbeat','Accept':'application/vnd.github+json','Content-Type':'application/json'}
    opener=urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(urllib.request.Request(url,headers=headers),timeout=30) as response:previous=json.load(response)
    except __import__('urllib.error',fromlist=['HTTPError']).HTTPError as error:
        if error.code!=404:raise
        previous=None
    body={'message':'Keep autonomous catalog schedules active','branch':'main','content':base64.b64encode((json.dumps({'checked_at':datetime.now(timezone.utc).isoformat(),'execution':'github-hosted'})+'\n').encode()).decode()}
    if previous:body['sha']=previous['sha']
    with opener.open(urllib.request.Request(url,method='PUT',headers=headers,data=json.dumps(body).encode()),timeout=30) as response:
        if response.status not in (200,201):raise ValueError('Heartbeat update failed')
    print(json.dumps({'repository_heartbeat':'committed'}))

if __name__=='__main__':main()
