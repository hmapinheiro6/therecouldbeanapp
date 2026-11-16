"""Official APIs. Feed adapters stay disabled until permissions are documented."""
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from .safe_web import canonicalize, FetchError
from .extraction import now

EXCLUDE=re.compile(r'\b(tutorial|boilerplate|starter|template|homework|awesome list|roadmap|course|my first|experiment)\b',re.I)

def parse_hn(item):
    title=item.get('title','')
    if not title.startswith('Show HN:') or item.get('dead') or item.get('deleted') or not item.get('url') or EXCLUDE.search(title):return None
    try:url=canonicalize(item['url'])
    except ValueError:return None
    if len(url.encode('utf-16-le'))//2>2000:return None
    if url.startswith(('https://github.com/','https://youtube.com/','https://youtu.be/')):return None
    title=title.removeprefix('Show HN:').strip()
    name=re.split(r'\s(?:–|—|\-|:)\s|: ',title)[0].strip()[:100]
    timestamp=datetime.fromtimestamp(item['time'],timezone.utc).isoformat().replace('+00:00','Z')
    return {'name':name,'canonical_url':url,'source_name':'Hacker News','source_type':'hackernews','source_url':'https://news.ycombinator.com/item?id='+str(item['id']),'external_id':str(item['id']),'discovered_at':timestamp,'resolve_identity':True}

def parse_github(repo):
    if repo.get('archived') or repo.get('fork') or repo.get('size',0)<20 or not repo.get('homepage') or not repo.get('description') or EXCLUDE.search(repo.get('description','')+' '+repo.get('name','')):return None
    try:url=canonicalize(repo['homepage'])
    except ValueError:return None
    if len(url.encode('utf-16-le'))//2>2000:return None
    if url.startswith('https://github.com/'):return None
    return {'name':repo['name'].replace('-',' '),'canonical_url':url,'source_name':'GitHub','source_type':'github','source_url':repo['html_url'],'external_id':str(repo['id']),'discovered_at':now(),'resolve_identity':True}

def parse_feed(text,kind='rss'):
    if len(text)>524288:raise ValueError('Feed too large')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():raise ValueError('XML entities are not accepted')
    if kind=='json':
        data=json.loads(text);items=data.get('items',[])[:50]
        return [{'name':i.get('title','')[:100],'canonical_url':canonicalize(i.get('external_url') or i['url']),'external_id':str(i['id'])[:200]} for i in items]
    root=ET.fromstring(text);entries=root.findall('.//item') or root.findall('{http://www.w3.org/2005/Atom}entry')
    out=[]
    for e in entries[:50]:
        title=e.findtext('title') or e.findtext('{http://www.w3.org/2005/Atom}title') or ''
        link=e.findtext('link');atom=e.find('{http://www.w3.org/2005/Atom}link')
        if not link and atom is not None:link=atom.get('href')
        if not link:continue
        try:url=canonicalize(link)
        except ValueError:continue
        out.append({'name':title[:100],'canonical_url':url,'external_id':e.findtext('guid') or e.findtext('{http://www.w3.org/2005/Atom}id') or url})
    return out

class Sources:
    def __init__(self,web):self.web=web
    def json(self,url):
        r=self.web._raw(url)
        if r['status']!=200:raise FetchError('Source unavailable')
        return json.loads(r['text'])
    def hackernews(self,checkpoint=None,limit=30):
        # Read a complete time window before consuming oldest first. A timestamp/id
        # cursor preserves ties and never skips unconsumed leads when the quota fills.
        start,after_id=map(int,checkpoint.split(':')) if checkpoint else (int((datetime.now(timezone.utc)-timedelta(days=2)).timestamp()),0)
        end=min(start+86400,int(datetime.now(timezone.utc).timestamp())+1)
        hits=[]
        for page in range(5):
            payload=self.json('https://hn.algolia.com/api/v1/search_by_date?'+urlencode({'tags':'show_hn','numericFilters':f'created_at_i>={start},created_at_i<{end}','hitsPerPage':100,'page':page}))
            if payload.get('nbPages',1)>5:raise FetchError('Show HN window exceeds bounded pagination; operator review required',False)
            hits.extend(payload.get('hits',[]))
            if page+1>=payload.get('nbPages',1):break
        out=[];cursor=checkpoint
        for hit in sorted(hits,key=lambda h:(h['created_at_i'],int(h['objectID']))):
            key=(hit['created_at_i'],int(hit['objectID']))
            if key<=(start,after_id):continue
            item={'id':key[1],'time':key[0],'title':hit.get('title',''),'url':hit.get('url')}
            candidate=parse_hn(item)
            cursor=f'{key[0]}:{key[1]}'
            if candidate:out.append(candidate)
            if len(out)>=limit:return out,cursor
        return out,f'{end}:0'

    def github(self,checkpoint=None,limit=30,topic='saas'):
        # A day is fully paged before advancing; page+offset retains candidates when
        # the verification quota is smaller than a source response.
        if checkpoint and checkpoint.startswith('{'):
            state=json.loads(checkpoint);day=state['day'];page=state['page'];offset=state['offset']
        else:
            day=(datetime.now(timezone.utc)-timedelta(days=2)).strftime('%Y-%m-%d');page=1;offset=0
        if day>=datetime.now(timezone.utc).strftime('%Y-%m-%d'):
            return [],json.dumps({'day':day,'page':1,'offset':0},separators=(',',':'))
        query=f'created:{day} archived:false fork:false topic:{topic}'
        out=[]
        for _ in range(5):
            payload=self.json('https://api.github.com/search/repositories?'+urlencode({'q':query,'sort':'created','order':'asc','per_page':100,'page':page}))
            if payload.get('incomplete_results') or payload.get('total_count',0)>1000:
                raise FetchError('GitHub source window incomplete; operator review required',False)
            repos=payload.get('items',[])
            for index in range(offset,len(repos)):
                candidate=parse_github(repos[index])
                if candidate:out.append(candidate)
                if len(out)>=limit:return out,json.dumps({'day':day,'page':page,'offset':index+1},separators=(',',':'))
            if len(repos)<100 or page*100>=payload.get('total_count',0):
                next_day=(datetime.fromisoformat(day)+timedelta(days=1)).strftime('%Y-%m-%d')
                return out,json.dumps({'day':next_day,'page':1,'offset':0},separators=(',',':'))
            page+=1;offset=0
        return out,json.dumps({'day':day,'page':page,'offset':0},separators=(',',':'))
