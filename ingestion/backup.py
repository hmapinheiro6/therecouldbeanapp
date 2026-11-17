"""Encrypted full private D1 + collector-state backup to fourteen bounded R2 slots."""
import argparse
import base64
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import urllib.request
from .extraction import ROOT
from .durable_state import StateBranch

BUCKET='therecouldbeanapp-private-operations'
ACCOUNT='272cf24b9368ff4a4c6833562cae0f0d'
MAX_SQL=96*1024*1024

def command(args):
    result=subprocess.run(args,cwd=ROOT,capture_output=True)
    if result.returncode:raise RuntimeError('Backup subprocess failed: '+args[0])
    return result.stdout

def crypt(mode,source,target):
    command(['node','scripts/sealed-backup.mjs',mode,str(source),str(target)])

def verify_payload(payload,directory):
    if payload.get('version')!=1 or payload.get('database')!='therecouldbeanapp-catalog' or not isinstance(payload.get('sql'),str) or len(payload['sql'].encode())>MAX_SQL:
        raise ValueError('Invalid full backup payload')
    path=directory/'restored.sqlite'
    if path.exists():raise ValueError('Restore must use a new database')
    database=sqlite3.connect(path)
    os.chmod(path,0o600)
    try:
        database.executescript(payload['sql'])
        if database.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Restored database integrity failed')
        tables={r[0] for r in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required={'products','submissions','admin_sessions','ingestion_checkpoints','publication_blocks'}
        if not required<=tables:raise ValueError('Full backup is missing private tables')
        counts={name:database.execute('SELECT COUNT(*) FROM '+name).fetchone()[0] for name in sorted(required)}
        state_counts={}
        for kind,cipher in payload['states'].items():
            if kind not in ('cloud','expansion'):raise ValueError('Unknown collector state')
            sealed=directory/(kind+'.enc');opened=directory/(kind+'.json')
            sealed.write_bytes(base64.b64decode(cipher));os.chmod(sealed,0o600)
            script='scripts/sealed-'+('cloud' if kind=='cloud' else 'expansion')+'-state.mjs'
            command(['node',script,'open',str(sealed),str(opened)])
            state=json.loads(opened.read_text())
            if state.get('version')!=1 or not isinstance(state.get('records'),list):raise ValueError('Restored collector state invalid')
            state_counts[kind]=len(state['records'])
        if set(state_counts)!= {'cloud','expansion'}:raise ValueError('Full backup must include both durable collectors')
        return {'restore':'verified_new_database','integrity':'ok','table_counts':counts,'restored_collector_records':state_counts,'production_database_modified':False}
    finally:database.close()

def ensure_bucket():
    token=os.environ['CLOUDFLARE_API_TOKEN']
    base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/r2/buckets'
    headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
    with urllib.request.urlopen(urllib.request.Request(base,headers=headers),timeout=30) as response:data=json.load(response)
    if not data.get('success'):raise ValueError('Private R2 bucket discovery failed; enable R2 first')
    if BUCKET not in {b['name'] for b in data['result']['buckets']}:
        with urllib.request.urlopen(urllib.request.Request(base,headers=headers,method='POST',data=json.dumps({'name':BUCKET}).encode()),timeout=30) as response:
            if not json.load(response).get('success'):raise ValueError('Private R2 bucket creation failed')

def create():
    if os.environ.get('GITHUB_ACTIONS')!='true':raise ValueError('Scheduled backup runs only on the hosted runner')
    ensure_bucket()
    with tempfile.TemporaryDirectory(prefix='tcba-private-backup-') as name:
        directory=Path(name);os.chmod(directory,0o700)
        sql=directory/'full.sql';plain=directory/'backup.json';sealed=directory/'backup.enc'
        command(['npx','wrangler','d1','export','DB','--remote','--output',str(sql)])
        os.chmod(sql,0o600)
        if sql.stat().st_size>MAX_SQL:raise ValueError('Full export exceeds backup budget')
        states={}
        for kind in ('cloud','expansion'):
            value=StateBranch(kind).read()
            if not value:raise ValueError('Durable collector checkpoint missing; backup incomplete')
            states[kind]=base64.b64encode(value).decode()
        payload={'version':1,'created_at':datetime.now(timezone.utc).isoformat(),'database':'therecouldbeanapp-catalog','sql':sql.read_text(),'states':states}
        plain.write_text(json.dumps(payload));os.chmod(plain,0o600)
        crypt('seal',plain,sealed)
        # Authenticate the encrypted copy and exercise a new database before storage.
        plain.unlink();crypt('open',sealed,plain)
        proof=verify_payload(json.loads(plain.read_text()),directory)
        slot=(datetime.now(timezone.utc).date()-datetime(1970,1,1).date()).days%14
        for key in ('backups/day-'+str(slot)+'.enc','backups/latest.enc'):
            command(['npx','wrangler','r2','object','put',BUCKET+'/'+key,'--file',str(sealed),'--remote','--content-type','application/octet-stream'])
        health={'last_success_at':datetime.now(timezone.utc).isoformat(),'restore_integrity':'ok','storage':'private_r2','retention_slots':14}
        url='https://api.github.com/repos/hmapinheiro6/therecouldbeanapp/contents/data/backup-health.json'
        headers={'Authorization':'Bearer '+os.environ['GITHUB_TOKEN'],'User-Agent':'tcba-backup-health','Content-Type':'application/json'}
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=30) as response:previous=json.load(response)
        except __import__('urllib.error',fromlist=['HTTPError']).HTTPError as error:
            if error.code!=404:raise
            previous=None
        body={'branch':'main','message':'Record verified encrypted database backup','content':base64.b64encode((json.dumps(health)+'\n').encode()).decode()}
        if previous:body['sha']=previous['sha']
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers,method='PUT',data=json.dumps(body).encode()),timeout=30) as response:
            if response.status not in (200,201):raise ValueError('Backup health publication failed')
        print(json.dumps({**proof,'encrypted_bytes':sealed.stat().st_size,'storage':'private_r2','retention_slots':14}))

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('stage',choices=['create','verify']);parser.add_argument('--file');args=parser.parse_args()
    try:
        if args.stage=='create':create()
        else:
            if not args.file:raise ValueError('Encrypted backup path required')
            with tempfile.TemporaryDirectory(prefix='tcba-restore-') as name:
                directory=Path(name);plain=directory/'backup.json';crypt('open',Path(args.file),plain)
                print(json.dumps(verify_payload(json.loads(plain.read_text()),directory)))
    except Exception as error:
        print(json.dumps({'backup':'failed','kind':type(error).__name__}))
        raise SystemExit(1)

if __name__=='__main__':main()
