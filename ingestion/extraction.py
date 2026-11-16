import json
import re
from html.parser import HTMLParser
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlsplit
from .safe_web import canonicalize, FetchError
ROOT=Path(__file__).resolve().parents[1]
SYNONYMS=json.loads((ROOT/'data/synonyms.json').read_text())
CAPABILITIES={c['slug']:c for c in json.loads((ROOT/'data/capabilities.json').read_text())}

def direct_capability(slug,sentence):
    """Conservative guards for ambiguous discovery phrases, separate from search synonyms."""
    if re.search(r'\b(built by|created by|founder|freelance|our customers|our clients)\b',sentence,re.I):return False
    if re.search(r'\b(pays? for|total cost|sponsor\w*|profit|use prompt|api directory)\b',sentence,re.I):return False
    if slug=='video' and not re.search(r'\b(edit\w*|video editor)\b',sentence,re.I):return False
    if slug=='graphics' and not re.search(r'\b(create\w*|design (?:software|tool|platform)|graphic design (?:software|tool|platform))\b',sentence,re.I):return False
    if slug=='meetings' and not re.search(r'\b(transcri\w*|meeting notes|meeting transcription)\b',sentence,re.I):return False
    if slug=='support' and not re.search(r'\b((?:customer support|support tickets|help ?desk|support inbox) (?:software|platform|tool|system)|(?:manage\w*|handle\w*|runs?|automate\w*) (?:your |a |the )?(?:customer support|support tickets|support inbox))\b',sentence,re.I):return False
    if slug=='payments' and not re.search(r'\b(accept payments|payment gateway|online payments|payment processing (?:platform|service)|process(?:es)? payments)\b',sentence,re.I):return False
    if slug=='search' and not re.search(r'\b((?:site search|search engine|full text search|search api) (?:platform|service|software)|(?:provides?|builds?|adds?|offers?) (?:a |an |fast )?(?:site search|search engine|full text search|search api))\b',sentence,re.I):return False
    if slug=='ecommerce' and not re.search(r'\b(storefront|shopping cart|sell products|e.?commerce platform|online store)\b',sentence,re.I):return False
    if slug=='ci':
        if re.search(r'\b(audit|scanner|scanning|hardening|vulnerability|checks|security)\b',sentence,re.I):return False
        if not re.search(r'\b(continuous integration|automated builds|(?:ci.?cd|build|deployment) (?:platform|service))\b',sentence,re.I):return False
    if slug=='storage' and not re.search(r'\b(file storage (?:platform|service)|cloud storage (?:platform|service)|(?:store|share) (?:your )?files (?:securely|online)|secure file sharing)\b',sentence,re.I):return False
    if slug=='reminders' and not re.search(r'\b(remind\w*|(?:scheduled|automatic|automated) follow.up)\b',sentence,re.I):return False
    return True

def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip=0;self.title='';self.in_title=False;self.parts=[];self.meta={};self.json_ld=[];self.ld=False;self.ld_parts=[];self.icons=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='script' and a.get('type')=='application/ld+json':self.ld=True;self.ld_parts=[]
        if tag in ('script','style','noscript','svg','nav','footer'):self.skip+=1
        if tag=='title':self.in_title=True
        if tag=='meta':
            key=(a.get('property') or a.get('name') or '').lower().strip()
            self.meta.setdefault(key, a.get('content') or '')
        if tag=='link' and 'icon' in (a.get('rel') or '').lower().split():self.icons.append(a.get('href') or '')
        if tag in ('h1','h2','h3','p','li','div','section'):self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag=='script' and self.ld:
            try:self.json_ld.append(json.loads(''.join(self.ld_parts)))
            except ValueError:pass
            self.ld=False
        if tag in ('script','style','noscript','svg','nav','footer'):self.skip=max(0,self.skip-1)
        if tag=='title':self.in_title=False
        if tag in ('h1','h2','h3','p','li','div','section'):self.parts.append('\n')
    def handle_data(self,data):
        if self.ld:self.ld_parts.append(data)
        if self.in_title:self.title+=data
        if not self.skip:self.parts.append(data)
    def sentences(self):
        text='\n'.join([self.title,self.meta.get('description',''),self.meta.get('og:description',''),' '.join(self.parts)])
        return [re.sub(r'\s+',' ',s).strip() for s in re.split(r'[\n.!?]+',text) if len(s.strip())>=8]

def evidence_from(sentences,allowed=None):
    # Prefer explanatory feature prose over navigation labels and footer fragments.
    sentences=[s for s in sentences if len(s)<=500]
    sentences=sorted(sentences,key=lambda s: (bool(re.search(r"\b(manage|create|track|provides|enables|supports|organize|record|transcri|schedule|helps|platform|software|tool|build)\w*",s,re.I)), min(len(s),180)),reverse=True)
    found=[]
    for slug,aliases in SYNONYMS.items():
        if allowed is not None and slug not in allowed:continue
        for sentence in sentences:
            # Marketing negations and integration lists must not become positive product claims.
            if re.search(r'\b(no |not |without |integrat(?:e[sd]?|ions?) (?:with|include)|connect with|alternative to|compare|coming soon)',sentence,re.I):continue
            if allowed is None and not direct_capability(slug,sentence):continue
            normalized=re.sub(r'[^a-z0-9 ]',' ',sentence.lower())
            normalized=re.sub(r'\s+',' ',normalized)
            terms=aliases if allowed is not None else [a for a in aliases if len(a.split())>=2 or a in ('crm','invoicing','bookkeeping','whiteboard','timesheets')]
            if any(re.search(r'\b'+re.escape(a)+r'\b',normalized) for a in terms):
                found.append({'slug':slug,'evidence_text':sentence[:500]});break
    return found[:12]

def confirmed_name(candidate,parser,content,url):
    name=candidate['name'][:100].strip()
    if len(name)>=2 and name.lower() in content:return name
    # Show HN titles often describe the app instead of naming it. Resolve only
    # explicit official metadata that also matches a label in its own domain.
    if candidate.get('resolve_identity') and urlsplit(url).path.strip('/') in ('','en','en-us','home','app'):
        options=[parser.meta.get('og:site_name',''),*re.split(r'\s[|–—-]\s|: ',parser.title)]
        labels={re.sub(r'[^a-z0-9]','',part) for part in urlsplit(url).hostname.split('.')[:-1]}
        for option in options:
            option=option.strip()
            if 2<=len(option)<=60 and len(option.split())<=5 and re.sub(r'[^a-z0-9]','',option.lower()) in labels and option.lower() in content:
                return option
    raise FetchError('Product name could not be confirmed on official website',False)

def verify(candidate,web,curated=False):
    url=canonicalize(candidate['canonical_url'])
    page=web.fetch(url)
    if page['status']!=200 or 'html' not in page['content_type']:raise FetchError('No usable public product page',False)
    parser=Metadata();parser.feed(page['text']);sentences=parser.sentences()
    if len(' '.join(sentences))<80:raise FetchError('Insufficient public product evidence',False)
    # Candidate product names are checked against the actual official page.
    content=' '.join(sentences).lower()
    name=confirmed_name(candidate,parser,content,page['url'])
    if not curated and not re.search(r'\b(software|application|platform|app|tool|open.source|dashboard)\b',content):raise FetchError('Usable software identity not established',False)
    claims=evidence_from(sentences,candidate.get('capability_hints') if curated else None)
    if not claims:raise FetchError('No explicit capability evidence found',False)
    timestamp=now()
    for c in claims:c.update(evidence_url=page['url'],verified_at=timestamp)
    primary=CAPABILITIES[claims[0]['slug']]
    # Automatic listings use original, controlled factual prose, not copied descriptions.
    description=candidate.get('editorial_description') if curated else name+' provides '+', '.join(CAPABILITIES[c['slug']]['name'].lower() for c in claims[:3])+'.'
    slug=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
    if not curated:
        import hashlib
        slug+='-'+hashlib.sha256(url.encode()).hexdigest()[:8]
    return {'slug':candidate.get('slug',slug),'name':name,'canonical_url':url,'short_description':description,'category_slug':candidate.get('category_slug',primary['category']) if curated else primary['category'],'audience':candidate.get('audience','') if curated else '', 'search_aliases':'','first_seen_at':candidate.get('created_at',timestamp),'announced_at':None,'last_verified_at':timestamp,'capabilities':claims,'source':{'source_type':candidate.get('source_type','official'),'source_name':candidate.get('source_name','Official website'),'source_url':candidate.get('source_url',url),'external_id':candidate.get('external_id',url),'discovered_at':candidate.get('discovered_at',timestamp)},**({'submission_id':candidate['submission_id']} if candidate.get('submission_id') else {})}
