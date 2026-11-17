"""Dated public product observations, never an uptime SLA or a product launch guess."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import time
from threading import Lock
from urllib.parse import urlsplit, urljoin, parse_qs
from .extraction import Metadata, ROOT, now
from .preview_metadata import plain
from .public_catalog import published_products, snapshot_products, SLUG
from .safe_web import SafeWeb, FetchError, canonicalize

DIRECTORY = ROOT / 'public/catalog-intelligence'
MAX_BYTES = 32 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_RECORDS = 4000
REPO = re.compile(r'https://github.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:/)?\Z')
APP_TYPES = {'SoftwareApplication', 'WebApplication', 'MobileApplication', 'DesktopApplication'}
PREVIEW_LOCK = Lock()


def day(value, stamp):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T[^\s]+)?', value):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return value[:10] if '1900-01-01' <= value[:10] <= stamp[:10] else None
    except ValueError:
        return None


def norm(value):
    return re.sub(r'[\W_]', '', str(value).casefold())


def same_site(a, b):
    try:
        return urlsplit(canonicalize(a)).hostname == urlsplit(canonicalize(b)).hostname
    except (ValueError, TypeError):
        return False


def same_product(a, b):
    try:
        return canonicalize(a) == canonicalize(b)
    except (ValueError, TypeError):
        return False


class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = []; self.dates = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('nav', 'footer', 'script', 'style'): self.skip += 1
        if tag == 'a' and a.get('href') and len(self.links) < 200: self.links.append(a['href'])
        if tag == 'time' and not self.skip and a.get('datetime') and len(self.dates) < 100: self.dates.append(a['datetime'])
    def handle_endtag(self, tag):
        if tag in ('nav', 'footer', 'script', 'style'): self.skip = max(0, self.skip - 1)


def software_facts(product, parser, source, stamp):
    facts = {}; pending = [(x, 0) for x in parser.json_ld[:20]]; visited = 0
    while pending and visited < 100:
        value, depth = pending.pop(0); visited += 1
        if depth > 6: continue
        if isinstance(value, list):
            pending.extend((x, depth + 1) for x in value[:30]); continue
        if not isinstance(value, dict): continue
        types = value.get('@type', []); types = [types] if isinstance(types, str) else types
        if isinstance(types, list) and APP_TYPES.intersection(x for x in types if isinstance(x, str)) and norm(value.get('name')) == norm(product['name']):
            if value.get('url') and not same_product(value['url'], product['canonical_url']): continue
            for field, key in [('publication', 'datePublished'), ('publisher_update', 'dateModified')]:
                date = day(value.get(key), stamp)
                if date: facts[field] = {'date': date, 'source_url': source, 'kind': 'publisher_reported', 'observed_at': stamp}
            version = value.get('softwareVersion')
            if isinstance(version, str) and version.strip():
                facts['version'] = {'value': plain(version, 80), 'source_url': source, 'kind': 'publisher_reported', 'observed_at': stamp}
        pending.extend((value[k], depth + 1) for k in ('@graph', 'mainEntity', 'mainEntityOfPage') if isinstance(value.get(k), (dict, list)))
    return facts


def website_observation(product, page=None, parser=None, error=None):
    source = product['canonical_url']; status = None
    if error:
        message = str(error).lower(); status = getattr(error, 'http_status', None)
        state = 'restricted' if status in (401, 403, 429) or 'robots' in message or 'restricted' in message else 'unreachable' if isinstance(error, FetchError) and ('network' in message or 'dns' in message or 'tls' in message or status and status >= 500) else 'unknown'
    elif page:
        source = page['url']; status = page['status']
        if status == 404: state = 'unreachable'
        elif status in (401, 403, 429): state = 'restricted'
        elif status >= 500: state = 'unreachable'
        elif status != 200 or 'html' not in page.get('content_type', '').lower(): state = 'unknown'
        elif not same_site(source, product['canonical_url']): state = 'identity_unconfirmed'
        else:
            title = (parser.title + ' ' + parser.meta.get('og:title', '') + ' ' + parser.meta.get('og:site_name', '')) if parser else ''
            identity = norm(product['name'])
            matched = bool(identity) and (identity in norm(title) if len(identity) >= 4 else bool(re.search(r'(?<!\w)' + re.escape(product['name']) + r'(?!\w)', title, re.I)))
            parked = bool(re.search(r'\b(domain for sale|buy this domain|domain parked|page not found|404 not found)\b', title, re.I))
            state = 'reachable' if matched and not parked else 'identity_unconfirmed'
    else: state = 'unknown'
    return {'state': state, 'source_url': source, 'http_status': status}


def update_record(product, previous, website, facts=None, stamp=None, enriched=False):
    stamp = stamp or now()
    old = previous if previous and previous.get('canonical_url') == product['canonical_url'] else None
    record = old or {'version': 1, 'slug': product['slug'], 'canonical_url': product['canonical_url'], 'first_observed_at': stamp, 'enriched_at': None, 'facts': {}, 'checks': [], 'history': []}
    record = json.loads(json.dumps(record))
    record['checked_at'] = stamp
    record['website'] = {**website, 'last_reachable_at': stamp if website['state'] == 'reachable' else (old or {}).get('website', {}).get('last_reachable_at')}
    checks = [x for x in record['checks'] if x['date'] != stamp[:10]]
    checks.append({'date': stamp[:10], 'state': website['state']}); record['checks'] = sorted(checks, key=lambda x: x['date'])[-56:]
    failures = 0
    for check in reversed(record['checks']):
        if check['state'] != 'unreachable': break
        failures += 1
    record['website']['failed_observation_days'] = failures
    changes = []
    if not old or old['website']['state'] != website['state']:
        changes.append(('website', website['state'], website['source_url']))
    for key, value in (facts or {}).items():
        former = record['facts'].get(key)
        if key in ('publication', 'earliest_release') and former and former['date'] < value['date']: continue
        if key in ('latest_release', 'publisher_update', 'changelog_entry') and former and former['date'] > value['date']: continue
        if not former or (former.get('value'), former.get('date')) != (value.get('value'), value.get('date')):
            changes.append((key, str(value.get('value', value.get('date', ''))), value['source_url']))
        record['facts'][key] = value
    for kind, value, source in changes:
        record['history'].append({'observed_at': stamp, 'kind': kind, 'value': value, 'source_url': source})
    record['history'] = record['history'][-32:]
    if enriched: record['enriched_at'] = stamp
    while len(record['history']) > 1 and len(json.dumps(record, ensure_ascii=True, separators=(',', ':')).encode()) + 1 > MAX_BYTES:
        record['history'].pop(0)
    return record


def read_record(path):
    if not path.exists(): return None
    if path.stat().st_size > MAX_BYTES: raise ValueError('Observation record exceeds budget')
    return json.loads(path.read_text())


def save_record(path, record):
    data = (json.dumps(record, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
    if len(data) > MAX_BYTES: raise ValueError('Observation record exceeds budget')
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp'); temp.write_bytes(data); temp.replace(path)


def observe_preview(product, page, parser):
    # The preview runner reuses the HTML already fetched. Shared workflow concurrency
    # prevents two hosted enrichment writers from editing this directory concurrently.
    slug = product.get('slug', '')
    if not isinstance(slug, str) or len(slug) > 100 or not SLUG.fullmatch(slug): return
    with PREVIEW_LOCK:
        DIRECTORY.mkdir(parents=True, exist_ok=True)
        path = DIRECTORY / (slug + '.json')
        if not path.exists() and len(list(DIRECTORY.glob('*.json'))) >= MAX_RECORDS: return
        previous = read_record(path); stamp = now()
        record = update_record(product, previous, website_observation(product, page, parser), software_facts(product, parser, page['url'], stamp), stamp)
        size = sum(p.stat().st_size for p in DIRECTORY.glob('*.json')) - (path.stat().st_size if path.exists() else 0)
        if size + len(json.dumps(record, ensure_ascii=True, separators=(',', ':')).encode()) + 1 <= MAX_TOTAL:
            save_record(path, record)


def repository(product, links):
    if REPO.fullmatch(product['canonical_url']): return product['canonical_url'].rstrip('/')
    sources = [s['source_url'] for s in product.get('sources', []) if s.get('source_type') == 'github']
    candidates = list(dict.fromkeys(u.rstrip('/') for u in [*sources, *links] if isinstance(u, str) and REPO.fullmatch(u)))
    return candidates[0] if len(candidates) == 1 else None


def github_facts(product, repo, web, stamp):
    match = REPO.fullmatch(repo)
    if not match: return {}
    api = 'https://api.github.com/repos/' + match[1] + '/' + match[2]
    response = web._raw(api)
    data = json.loads(response['text'])
    if response['status'] != 200 or data.get('private') is not False: return {}
    received = data.get('html_url', '')
    if not REPO.fullmatch(received) or not (same_product(repo, product['canonical_url']) or same_product(data.get('homepage'), product['canonical_url'])): return {}
    facts = {'repository_archived': {'value': bool(data.get('archived')), 'source_url': received, 'kind': 'repository_metadata', 'observed_at': stamp}}
    created = day(data.get('created_at'), stamp)
    if created: facts['repository_created'] = {'date': created, 'source_url': received, 'kind': 'repository_metadata', 'observed_at': stamp}
    # Latest and earliest available release pages only; no unbounded release crawl.
    releases = []
    try:
        response = web._raw(api + '/releases?per_page=10&page=1')
        initial = json.loads(response['text'])
        if response['status'] == 200 and isinstance(initial, list): releases = initial[:10]
        pages = re.findall(r'<([^>]+)>;\s*rel="last"', response.get('links', ''))
        if pages:
            last = pages[0]
            target = urlsplit(last); query = parse_qs(target.query, keep_blank_values=True)
            paths = {urlsplit(api).path + '/releases'}
            if type(data.get('id')) is int and data['id'] > 0: paths.add('/repositories/' + str(data['id']) + '/releases')
            # GitHub canonicalizes Link headers to its numeric repository ID.
            # Validate that ID, then fetch the original fixed repository path.
            number = query.get('page', [''])[0]
            if target.scheme == 'https' and target.netloc == 'api.github.com' and target.path in paths and not target.fragment and set(query) == {'page', 'per_page'} and query['per_page'] == ['10'] and len(query['page']) == 1 and re.fullmatch(r'\d{1,7}', number) and int(number) > 1:
                end = web._raw(api + '/releases?per_page=10&page=' + number)
                older = json.loads(end['text'])
                if end['status'] == 200 and isinstance(older, list): releases += older[:10]
    except (ValueError, FetchError, OSError, KeyError, TypeError): pass
    valid = [r for r in releases[:20] if isinstance(r, dict) and r.get('draft') is False and r.get('prerelease') is False and day(r.get('published_at'), stamp) and isinstance(r.get('html_url'), str) and r['html_url'].startswith(received + '/releases/')]
    for key, release in [('earliest_release', min(valid, key=lambda r: r['published_at']) if valid else None), ('latest_release', max(valid, key=lambda r: r['published_at']) if valid else None)]:
        if release:
            facts[key] = {'date': release['published_at'][:10], 'source_url': release['html_url'], 'kind': 'public_release', 'observed_at': stamp, 'value': plain(release.get('tag_name') or release.get('name') or 'Release', 80)}
    return facts


def collect(product, previous=None, web=None, github=None, stamp=None):
    web = web or SafeWeb(delay=1, max_pages=2, max_bytes=1024 * 1024)
    github = github or SafeWeb(delay=1, max_bytes=1024 * 1024, github_token=os.environ.get('GITHUB_TOKEN'))
    stamp = stamp or now(); facts = {}; page = None; parser = None; error = None; links = Links()
    try:
        page = web.fetch(product['canonical_url']); parser = Metadata(); parser.feed(page.get('text', '')); links.feed(page.get('text', ''))
        if website_observation(product, page, parser)['state'] == 'reachable':
            facts.update(software_facts(product, parser, page['url'], stamp))
            changelogs = [urljoin(page['url'], u) for u in links.links if re.search(r'/(?:changelog|release-notes)(?:/|$)', urlsplit(urljoin(page['url'], u)).path)]
            for url in changelogs[:1]:
                if not same_site(url, product['canonical_url']): continue
                try:
                    change = web.fetch(url); content = Metadata(); content.feed(change.get('text', '')); dates = Links(); dates.feed(change.get('text', ''))
                    if change['status'] == 200 and 'html' in change.get('content_type', '').lower() and same_site(change['url'], product['canonical_url']) and norm(product['name']) in norm(content.title):
                        known = [day(x, stamp) for x in dates.dates if day(x, stamp)]
                        if known: facts['changelog_entry'] = {'date': max(known), 'source_url': change['url'], 'kind': 'publisher_reported', 'observed_at': stamp}
                except (ValueError, FetchError, OSError, KeyError, TypeError): pass
    except (ValueError, FetchError, OSError) as caught: error = caught
    repo = repository(product, links.links if page and website_observation(product, page, parser)['state'] == 'reachable' else [])
    if repo:
        try: facts.update(github_facts(product, repo, github, stamp))
        except (ValueError, FetchError, OSError, KeyError, TypeError): pass
    return update_record(product, previous, website_observation(product, page, parser, error), facts, stamp, enriched=True)


def run(limit=100, directory=DIRECTORY, products=None, web_factory=SafeWeb):
    if not 1 <= limit <= 100: raise ValueError('Use 1–100 products')
    directory.mkdir(parents=True, exist_ok=True)
    files = list(directory.glob('*.json'))
    if len(files) > MAX_RECORDS or sum(p.stat().st_size for p in files) > MAX_TOTAL: raise ValueError('Observation storage budget reached')
    products = products if products is not None else published_products(web_factory(delay=1, max_pages=3), snapshot_products(), directory)
    # The forward index may have been created or grown by published_products.
    files = list(directory.glob('*.json'))
    if len(files) > MAX_RECORDS or sum(p.stat().st_size for p in files) > MAX_TOTAL: raise ValueError('Observation storage budget reached')
    eligible = []; stamp = now(); moment = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
    for product in products:
        slug = product.get('slug', '')
        if not isinstance(slug, str) or len(slug) > 100 or not SLUG.fullmatch(slug): continue
        path = directory / (slug + '.json')
        try:
            previous = read_record(path)
            checked = previous.get('enriched_at') if previous and previous.get('canonical_url') == product['canonical_url'] else None
            if checked and moment - datetime.fromisoformat(checked.replace('Z', '+00:00')) < timedelta(days=1 if previous['website']['state'] == 'unreachable' and previous['website']['failed_observation_days'] < 3 else 7): continue
            eligible.append(((0 if checked and previous['website']['state'] == 'unreachable' and previous['website']['failed_observation_days'] < 3 else 1, checked or '', 0 if product.get('verification_scope') == 'capabilities' else 1, 0 if REPO.fullmatch(product['canonical_url']) else 1, slug), product, path, previous))
        except (ValueError, KeyError, TypeError): continue
    selected = []; capacity = MAX_RECORDS - len(files)
    for item in sorted(eligible, key=lambda x: x[0]):
        if not item[2].exists():
            if capacity <= 0: continue
            capacity -= 1
        selected.append(item)
        if len(selected) == limit: break
    summary = {'checked': 0, 'reachable': 0, 'restricted': 0, 'unreachable': 0, 'identity_unconfirmed': 0, 'unknown': 0, 'with_dated_facts': 0, 'd1_writes': 0, 'execution': 'github-hosted' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'local-verification'}
    deadline = time.monotonic() + 8 * 60
    def check(item):
        if time.monotonic() > deadline: return None
        _, product, path, previous = item
        return path, collect(product, previous, web_factory(delay=1, max_pages=2, max_bytes=1024 * 1024), web_factory(delay=1, max_bytes=1024 * 1024, github_token=os.environ.get('GITHUB_TOKEN')))
    size = sum(p.stat().st_size for p in files)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for future in as_completed([pool.submit(check, item) for item in selected]):
            result = future.result()
            if not result: continue
            path, record = result
            size += len(json.dumps(record, ensure_ascii=True, separators=(',', ':')).encode()) + 1 - (path.stat().st_size if path.exists() else 0)
            if size > MAX_TOTAL: raise ValueError('Observation storage budget reached')
            save_record(path, record); summary['checked'] += 1; summary[record['website']['state']] += 1
            summary['with_dated_facts'] += any('date' in fact for fact in record['facts'].values())
    summary['stored_bytes'] = size
    print(json.dumps(summary))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as output:
            output.write('\n## Product observations\n\n' + json.dumps(summary) + '\n\nWebsite observations are not application uptime or hands-on tests. Unknown product ages stay unknown.\n')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--limit', type=int, default=100); args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS') != 'true': raise SystemExit('Collection runs on the hosted GitHub workflow')
    run(args.limit)
