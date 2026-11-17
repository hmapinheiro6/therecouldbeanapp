"""Bounded, data-only readers for permitted application metadata. Never runs installers."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import tempfile
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
import yaml
from .extraction import now
from .safe_web import SafeWeb, FetchError, PinnedHTTPS, resolve_public, USER_AGENT, canonicalize

ARCHIVES = {
    'winget': ('microsoft/winget-pkgs', 'master', 'MIT'),
    'scoop-extras': ('ScoopInstaller/Extras', 'master', 'Unlicense'),
    'scoop-main': ('ScoopInstaller/Main', 'master', 'Unlicense'),
}
MAX_ARCHIVE = 384 * 1024 * 1024
MAX_EXPANDED = 3 * 1024 * 1024 * 1024
NON_PRODUCT = re.compile(r'\b(sdk|redistributable|runtime|device driver|language pack|font family|development kit|uninstaller|update assistant|boilerplate|template|library)\b', re.I)
UNOFFICIAL_HOSTS = {'softsea.com','softpedia.com','filehippo.com','majorgeeks.com','download.cnet.com','uptodown.com','softonic.com'}

def third_party_homepage(host):
    host=(host or '').removeprefix('www.')
    return any(host==blocked or host.endswith('.'+blocked) for blocked in UNOFFICIAL_HOSTS)

EXCLUDED_HOSTS = {'apps.microsoft.com', 'apps.apple.com', 'play.google.com', 'www.microsoft.com', 'microsoft.com', 'sourceforge.net', 'www.sourceforge.net'}


def text(value, length=600):
    value = re.sub(r'[<>\x00-\x1f]', ' ', str(value or ''))
    return re.sub(r'\s+', ' ', value).strip().encode('utf-16-le')[:length*2].decode('utf-16-le', errors='ignore')


def candidate(name, homepage, description, source, source_url, external_id, aliases=(), audience='Windows software users'):
    name = text(name,100); description = text(description,450)
    if len(name)<2 or not description or NON_PRODUCT.search(name+' '+description): return None
    try: homepage=canonicalize(homepage)
    except (ValueError, TypeError): return None
    parsed=urlsplit(homepage)
    if parsed.hostname=='github.com':
        parts=parsed.path.strip('/').split('/')
        if len(parts)<2 or len(parts)>2 and parts[2] not in ('releases','tree','wiki'): return None
        homepage='https://github.com/'+'/'.join(parts[:2]);parsed=urlsplit(homepage)
    if third_party_homepage(parsed.hostname): return None
    if len(homepage)>1800 or parsed.hostname in EXCLUDED_HOSTS and parsed.path in ('','/'): return None
    if parsed.hostname and (parsed.hostname.endswith('.github.io') and parsed.path in ('','/')):
        pass  # A project's own GitHub Pages website can establish identity.
    return {'name':name,'aliases':list(dict.fromkeys([name,*[text(a,100) for a in aliases if isinstance(a,str) and len(a.strip())>=3]]))[:5],
        'canonical_url':homepage,'licensed_description':description,'source_name':source,'source_type':'feed','source_url':source_url,
        'external_id':text(external_id,200),'discovered_at':now(),'category_slug':'desktop-apps','audience':audience}


def archive(repo, ref):
    # Exactly these source repositories. Source downloads have a separate bounded
    # streaming budget; individual product pages keep the existing small limits.
    if (repo,ref) not in {(a,b) for a,b,_ in ARCHIVES.values()}: raise ValueError('Unapproved source archive')
    url='https://codeload.github.com/'+repo+'/tar.gz/refs/heads/'+ref
    if not SafeWeb().allowed(url): raise FetchError('Source archive denied by robots.txt',False)
    connection=PinnedHTTPS('codeload.github.com',resolve_public('codeload.github.com')[0],timeout=30)
    temporary=tempfile.TemporaryFile();deadline=time.monotonic()+600;size=0
    try:
        connection.request('GET',urlsplit(url).path,headers={'User-Agent':USER_AGENT,'Accept-Encoding':'identity'})
        response=connection.getresponse()
        if response.status!=200: raise FetchError('Source archive HTTP '+str(response.status),http_status=response.status)
        if int(response.getheader('Content-Length','0'))>MAX_ARCHIVE: raise ValueError('Source archive exceeds budget')
        while True:
            chunk=response.read(256*1024)
            if not chunk: break
            size+=len(chunk)
            if size>MAX_ARCHIVE or time.monotonic()>deadline: raise ValueError('Source archive budget reached')
            temporary.write(chunk)
        temporary.seek(0);return temporary
    except BaseException:
        temporary.close();raise
    finally: connection.close()


def members(stream):
    expanded=0;count=0
    with tarfile.open(fileobj=stream,mode='r|gz') as content:
        for item in content:
            count+=1;expanded+=max(0,item.size)
            if expanded>MAX_EXPANDED or count>1_500_000: raise ValueError('Expanded source archive exceeds budget')
            if not item.isfile() or item.size>128*1024 or '..' in Path(item.name).parts: continue
            # Consume metadata only. No filesystem extraction, installers or scripts.
            if not (item.name.endswith('.json') and '/bucket/' in item.name or re.search(r'\.locale\.en-US\.ya?ml$',item.name)): continue
            file=content.extractfile(item)
            if file: yield item.name, file.read(128*1024+1)


def winget_row(row, path):
    if not isinstance(row,dict) or row.get('ManifestType')!='defaultLocale' or row.get('PackageLocale')!='en-US': return None
    identifier=row.get('PackageIdentifier','')
    if not isinstance(identifier,str) or not identifier or len(identifier)>180: return None
    name=row.get('PackageName');aliases=[]
    # The identifier tail is an alias only when it is substantial and descriptive.
    tail=identifier.rsplit('.',1)[-1]
    if len(tail)>=4 and not tail.lower() in ('app','client','desktop','portable','install'): aliases.append(tail)
    return candidate(name,row.get('PackageUrl'),row.get('ShortDescription'),'WinGet manifests (MIT)',
        'https://github.com/microsoft/winget-pkgs/blob/master/'+path.split('/',1)[1],identifier,aliases)


def scoop_row(row, path, repo):
    if not isinstance(row,dict): return None
    name=Path(path).stem
    if name.endswith(('-nightly','-beta','-dev','-canary','-portable')): return None
    return candidate(name,row.get('homepage'),row.get('description'),'Scoop manifests (Unlicense)',
        'https://github.com/'+repo+'/blob/master/bucket/'+Path(path).name,repo+':'+name)


def directory(source, stream=None):
    if source not in ARCHIVES: raise ValueError('Unknown source')
    repo,ref,_=ARCHIVES[source];owned=stream is None;stream=stream or archive(repo,ref)
    rows={};versions={}
    try:
        for path,body in members(stream):
            try:
                if source=='winget':
                    # SafeLoader never executes YAML tags. Reject aliases to keep
                    # tiny manifests from representing unbounded object graphs.
                    raw=body.decode('utf-8-sig')
                    if re.search(r'(^|\s)[&*][A-Za-z_]',raw): continue
                    row=yaml.load(raw,Loader=getattr(yaml,'CSafeLoader',yaml.SafeLoader));c=winget_row(row,path)
                    if not c: continue
                    key=c['external_id'];version=row.get('PackageVersion') if isinstance(row.get('PackageVersion'),str) else Path(path).parent.name
                    order=tuple((0,int(t)) if t.isdigit() else (1,t.casefold()) for t in re.findall(r'\d+|[A-Za-z]+',version))
                    if key in versions and versions[key]>=order: continue
                    versions[key]=order;rows[key]=c
                else:
                    c=scoop_row(json.loads(body),path,repo)
                    if c: rows[c['external_id']]=c
                if len(rows)>35000: raise ValueError('Source candidate budget reached')
            except (yaml.YAMLError, UnicodeError, RecursionError, TypeError, KeyError, json.JSONDecodeError): continue
    finally:
        if owned: stream.close()
    return sorted(rows.values(),key=lambda c:hashlib.sha256(c['canonical_url'].encode()).hexdigest())


def flathub():
    url='https://dl.flathub.org/repo/appstream/x86_64/appstream.xml.gz'
    page=SafeWeb(max_bytes=32*1024*1024).fetch(url)
    if page['status']!=200: raise ValueError('Flathub metadata unavailable')
    stream=gzip.GzipFile(fileobj=io.BytesIO(page['body']));raw=stream.read(64*1024*1024+1)
    if len(raw)>64*1024*1024 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('Unsafe AppStream metadata')
    out=[]
    for app in ET.fromstring(raw).findall('component'):
        if app.get('type')!='desktop-application': continue
        license=app.findtext('metadata_license','').strip()
        if license not in ('CC0-1.0','0BSD','Unlicense'): continue
        names=app.findall('name');summaries=app.findall('summary')
        name=next((x.text for x in names if not x.get('{http://www.w3.org/XML/1998/namespace}lang')),None)
        summary=next((x.text for x in summaries if not x.get('{http://www.w3.org/XML/1998/namespace}lang')),None)
        homepage=next((x.text for x in app.findall('url') if x.get('type')=='homepage'),None)
        identifier=app.findtext('id','')
        c=candidate(name,homepage,summary,'Flathub AppStream ('+license+')','https://flathub.org/apps/'+identifier,identifier,audience='Linux desktop software users')
        if c: out.append(c)
    if len(out)>10000: raise ValueError('Flathub metadata exceeds budget')
    return out


def collect_sources():
    out={};counts={};errors={}
    for source in [*ARCHIVES,'flathub']:
        try:
            candidates=flathub() if source=='flathub' else directory(source)
            counts[source]=len(candidates)
            for c in candidates: out.setdefault(c['canonical_url'],c)
        except (OSError,ValueError,FetchError) as error: errors[source]=type(error).__name__
    if not counts: raise ValueError('No source completed')
    return list(out.values()),counts,errors


if __name__=='__main__':
    rows,counts,errors=collect_sources()
    print(json.dumps({'source_candidates':counts,'unique_candidate_urls':len(rows),'source_errors':errors,'published':0}))
