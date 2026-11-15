"""HMAC signed operations. Credentials never enter URLs or logs."""
import hashlib
import hmac
import json
import os
import time
import uuid
import urllib.request
import urllib.error
from urllib.parse import urlsplit
class InternalClient:
    def __init__(self,base=None,secret=None):
        self.base=(base or os.environ['INGESTION_API_URL']).rstrip('/')
        self.secret=secret or os.environ['INTERNAL_SECRET']
        u=urlsplit(self.base)
        if u.scheme!='https' and not (u.scheme=='http' and u.hostname in ('localhost','127.0.0.1')):raise ValueError('API must be HTTPS (localhost allowed only for development)')
        if len(self.secret)<32:raise ValueError('Internal secret must be at least 32 characters')
    def request(self,path,body=None):
        method='POST' if body is not None else 'GET'
        raw=json.dumps(body,separators=(',',':'),ensure_ascii=False).encode() if body is not None else b''
        # A retry receives a fresh nonce; mutations are idempotent at the record level.
        for attempt in range(3):
            timestamp=str(int(time.time()));nonce=str(uuid.uuid4())
            message='\n'.join([method,path,timestamp,nonce,hashlib.sha256(raw).hexdigest()])
            signature=hmac.new(self.secret.encode(),message.encode(),hashlib.sha256).hexdigest()
            req=urllib.request.Request(self.base+path,data=raw if body is not None else None,method=method,headers={'Content-Type':'application/json','X-Timestamp':timestamp,'X-Nonce':nonce,'X-Signature':signature})
            try:
                with urllib.request.urlopen(req,timeout=30) as r:
                    data=r.read(1048577)
                    if len(data)>1048576:raise RuntimeError('Internal response too large')
                    return json.loads(data)
            except urllib.error.HTTPError as e:
                if e.code not in (429,500,502,503,504) or attempt==2:raise RuntimeError('Internal API failed with HTTP '+str(e.code)) from None
            except urllib.error.URLError:
                if attempt==2:raise RuntimeError('Internal API connection failed') from None
            time.sleep(2**attempt)
        raise RuntimeError('Internal API retries exhausted')
