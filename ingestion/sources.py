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
    if url.startswith(('https://github.com/','https://youtube.com/','https://youtu.be/')):return None
    title=title.removeprefix('Show HN:').strip()
    name=re.split(r'\s(?:–|—|\-|:)\s|: ',title)[0].strip()[:100]
    timestamp=datetime.fromtimestamp(item['time'],timezone.utc).isoformat().replace('+00:00','Z')
    return {'name':name,'canonical_url':url,'source_name':'Hacker News','source_type':'hackernews','source_url':'https://news.ycombinator.com/item?id='+str(item['id']),'external_id':str(item['id']),'discovered_at':timestamp}

def parse_github(repo):
    if repo.get('archived') or repo.get('fork') or repo.get('size',0)<20 or not repo.get('homepage') or not repo.get('description') or EXCLUDE.search(repo.get('description','')+' '+repo.get('name','')):return None
    if not repo.get('topics') or repo.get('stargazers_count',0)<3:return None
    try:url=canonicalize(repo['homepage'])
    except ValueError:return None
    if url.startswith('https://github.com/'):return None
    return {'name':repo['name'].replace('-',' '),'canonical_url':url,'source_name':'GitHub','source_type':'github','source_url':repo['html_url'],'external_id':str(repo['id']),'discovered_at':now()}

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
        ids=self.json('https://hacker-news.firebaseio.com/v0/showstories.json')[:min(limit,30)]
        new=[i for i in ids if not checkpoint or i>int(checkpoint)]
        out=[]
        for i in new:
            item=self.json('https://hacker-news.firebaseio.com/v0/item/'+str(i)+'.json')
            if item:
                candidate=parse_hn(item)
                if candidate:out.append(candidate)
        # Advance only to an actually consumed item, after persistence by the caller.
        return out,str(max(ids)) if ids else checkpoint
    def github(self,checkpoint=None,limit=30):
        since=checkpoint or (datetime.now(timezone.utc)-timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%SZ')
        query='created:>'+since+' stars:>=3 archived:false fork:false topic:productivity topic:developer-tools'
        payload=self.json('https://api.github.com/search/repositories?'+urlencode({'q':query,'sort':'created','order':'asc','per_page':min(limit,30)}))
        repos=payload.get('items',[]);out=[c for r in repos if (c:=parse_github(r))]
        cursor=max((r['created_at'] for r in repos),default=checkpoint)
        return out,cursor
