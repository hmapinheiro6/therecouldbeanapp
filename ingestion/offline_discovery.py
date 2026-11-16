"""Resumable HN/GitHub discovery without any production API or database calls.

The journal and publication drafts stay under ignored .ingestion-state/. Every
new record still requires an operator's review and an explicit later import.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import fcntl
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import urlsplit

from .extraction import ROOT, CAPABILITIES, Metadata, confirmed_name, now, verify
from .evidence_audit import reviewable_claim
from .safe_web import FetchError, SafeWeb, canonicalize
from .sources import Sources

PRIVATE_ROOT = ROOT / '.ingestion-state'
TOPICS = ('saas', 'productivity', 'developer-tools')
WEB_CONTEXT = re.compile(r'\b(saas|web[ -]?(?:app(?:lication)?|based)|in (?:your|the) browser|browser[ -]based|online (?:tool|platform|application)|hosted (?:platform|service)|sign up|start (?:for )?free|cloud platform)\b', re.I)


def private_path(value):
    path = Path(value).resolve()
    if path == PRIVATE_ROOT.resolve() or not path.is_relative_to(PRIVATE_ROOT.resolve()):
        raise ValueError('Offline discovery files must stay inside .ingestion-state/')
    return path


def save_private(path, payload):
    path = private_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix='discovery-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(payload, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)



@contextmanager
def journal_lock(path):
    """Prevent simultaneous CLI runs from overwriting the same durable cursor."""
    path = private_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    descriptor = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        os.fchmod(handle.fileno(), 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError('Another offline discovery run owns this journal') from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def product_urls(snapshot):
    urls = set()
    for product in snapshot['products']:
        for value in [product['canonical_url'], *product.get('url_aliases', [])]:
            try:
                urls.add(canonicalize(value))
            except ValueError:
                continue
    return urls


def candidate_key(candidate):
    return hashlib.sha256((candidate['source_name'] + ':' + candidate['external_id']).encode()).hexdigest()


def new_state(lookback_days):
    start = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    return {'version': 1, 'created_at': now(), 'checkpoints': {
        'hackernews': str(int(start.timestamp())) + ':0',
        **{'github_' + topic: json.dumps({'day': start.strftime('%Y-%m-%d'), 'page': 1, 'offset': 0}, separators=(',', ':')) for topic in TOPICS},
    }, 'records': [], 'runs': []}


def collect(state, snapshot, sources, max_candidates, max_windows, persist):
    """Persist the whole page before its cursor; a crash cannot lose an item."""
    known = product_urls(snapshot)
    prior_urls = {canonicalize(record['candidate']['canonical_url']) for record in state['records']}
    prior_ids = {record['id'] for record in state['records']}
    adapters = [('hackernews', sources.hackernews), *[
        ('github_' + topic, lambda checkpoint, limit, topic=topic: sources.github(checkpoint, limit, topic)) for topic in TOPICS]]
    counts = {'source_candidates': 0, 'new_candidates': 0, 'duplicates': 0, 'source_windows': 0, 'source_errors': []}
    blocked = set()
    for _ in range(max_windows):
        for source_name, fetch in adapters:
            if counts['source_candidates'] >= max_candidates:
                return counts
            if source_name in blocked:
                continue
            cursor = state['checkpoints'].get(source_name)
            try:
                candidates, next_cursor = fetch(cursor, limit=min(25, max_candidates - counts['source_candidates']))
                counts['source_windows'] += 1
            except (FetchError, ValueError) as error:
                counts['source_errors'].append({'source': source_name, 'reason': str(error)[:180]})
                blocked.add(source_name)
                continue
            counts['source_candidates'] += len(candidates)
            for candidate in candidates:
                key = candidate_key(candidate)
                url = canonicalize(candidate['canonical_url'])
                if key in prior_ids or url in known or url in prior_urls:
                    counts['duplicates'] += 1
                    continue
                state['records'].append({'id': key, 'candidate': candidate, 'status': 'pending', 'discovered_at': now()})
                prior_ids.add(key)
                prior_urls.add(url)
                counts['new_candidates'] += 1
            state['checkpoints'][source_name] = next_cursor
            persist(state)
            if next_cursor == cursor:
                blocked.add(source_name)
    return counts



def identity_review_reason(candidate, name, page_title='', site_name=''):
    url = urlsplit(canonicalize(candidate['canonical_url']))
    if url.hostname in {'play.google.com', 'apps.apple.com', 'apps.microsoft.com', 'testflight.apple.com',
                        'npmjs.com', 'pypi.org', 'packagist.org', 'marketplace.visualstudio.com', 'chromewebstore.google.com'}:
        return 'Package/store listing does not establish a standalone web/SaaS product'
    if re.search(r'/(?:writing|blog|notes|work|whitepaper)(?:/|$)', url.path, re.I):
        return 'Article, portfolio or specification page needs manual live-product review'
    if len(name.split()) > 5:
        return 'Descriptive headline needs manual product-name review'
    normalize = lambda value: re.sub(r'[^a-z0-9]', '', value.lower())
    labels = [*url.hostname.split('.')[:-1], url.path.rstrip('/').split('/')[-1], site_name,
              *re.split(r'\s[|–—-]\s|: ', page_title)]
    if normalize(name) not in {normalize(label) for label in labels if label}:
        return 'Product name needs explicit official metadata or domain/path identity review'
    return None



def web_availability(sentence):
    """Require an affirmative app-availability statement, not a signup or industry list."""
    if re.search(r"\b(not a web app|not yet|coming soon|nothing to sign up|no account|demo data|account sign.in|browser extension|satirical|how.to|tokens live|MCP.capable)\b", sentence, re.I):
        return False
    if re.search(r'\b(?:runs?|works?|opens?|play|create|right|entirely|fully)\b.{0,100}\b(?:in|your|the) browser\b', sentence, re.I):
        return True
    if re.search(r'\b(?:browser.based|web.based|SaaS de)\b', sentence, re.I):
        return True
    return bool(re.search(r'\bweb app(?:lication)?(?: is)? (?:live|runs?|works?|on)\b|opens the web app', sentence, re.I))


def identity_only(draft):
    """New-product features require a separate editorial decision after discovery."""
    product = draft['product']
    if product['capabilities']:
        draft['unreviewed_feature_proposals'] = product['capabilities']
    product.update(verification_scope='identity', capabilities=[], category_slug='web-apps',
                   identity_evidence_url=draft['web_evidence_url'],
                   identity_evidence_text=draft['web_evidence_text'],
                   short_description=product['name'] + ' is a software product. Its capabilities have not yet been verified.')
    return draft


def assess(candidate, web):
    """Prepare a draft only after fetching a live official software website."""
    page = web.fetch(candidate['canonical_url'])
    if page['status'] != 200 or 'html' not in page['content_type']:
        raise FetchError('No usable public product page', False)
    if urlsplit(canonicalize(page['url'])).hostname != urlsplit(canonicalize(candidate['canonical_url'])).hostname:
        raise FetchError('Cross-host redirect requires manual official-identity review', False)
    parser = Metadata()
    parser.feed(page['text'])
    sentences = parser.sentences()
    content = ' '.join(sentences)
    if len(content) < 80:
        raise FetchError('Insufficient public product evidence', False)
    name = confirmed_name(candidate, parser, content.lower(), page['url'])
    identity_reason = identity_review_reason(candidate, name, parser.title, parser.meta.get('og:site_name', ''))
    if identity_reason:
        raise FetchError(identity_reason, False)
    if not re.search(r'\b(software|application|platform|app|tool|open.source|dashboard)\b', content, re.I):
        raise FetchError('Usable software identity not established', False)
    web_sentence = next((sentence for sentence in sentences if len(sentence) <= 500 and web_availability(sentence)), None)
    if not web_sentence:
        raise FetchError('Public evidence does not establish web/SaaS availability', False)

    class FetchedPage:
        def fetch(self, _url):
            return page

    try:
        product = verify(candidate, FetchedPage())
        product['capabilities'] = [claim for claim in product['capabilities'] if reviewable_claim(claim)]
        if not product['capabilities']:
            raise FetchError('No explicit capability evidence found', False)
        product['category_slug'] = CAPABILITIES[product['capabilities'][0]['slug']]['category']
        product['short_description'] = name + ' provides ' + ', '.join(CAPABILITIES[claim['slug']]['name'].lower() for claim in product['capabilities'][:3]) + '.'
        product['verification_scope'] = 'capabilities'
    except FetchError as error:
        if str(error) != 'No explicit capability evidence found':
            raise
        timestamp = now()
        url = canonicalize(candidate['canonical_url'])
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') + '-' + hashlib.sha256(url.encode()).hexdigest()[:8]
        product = {'slug': slug, 'name': name, 'canonical_url': url,
            'short_description': name + ' is a software product. Its capabilities have not yet been verified.',
            'category_slug': 'web-apps', 'audience': '', 'search_aliases': name,
            'first_seen_at': timestamp, 'announced_at': None, 'last_verified_at': timestamp,
            'verification_scope': 'identity', 'identity_evidence_url': page['url'],
            'identity_evidence_text': (parser.title.strip() or web_sentence)[:500], 'capabilities': [],
            'source': {key: candidate[key] for key in ('source_name', 'source_type', 'source_url', 'external_id', 'discovered_at')}}
    return identity_only({'product': product, 'web_evidence_url': page['url'], 'web_evidence_text': web_sentence,
            'identity_page_title': parser.title[:500], 'identity_site_name': parser.meta.get('og:site_name', '')[:100],
            'checked_at': now(), 'review_required': True, 'published': False})


def verify_pending(state, snapshot, max_verify, workers, persist, web_factory=None):
    known = product_urls(snapshot)
    pending = [record for record in state['records'] if record['status'] == 'pending'][:max_verify]
    locks = {}
    for record in pending:
        locks.setdefault(urlsplit(record['candidate']['canonical_url']).hostname, threading.Lock())

    webs = {}

    def check(record):
        if canonicalize(record['candidate']['canonical_url']) in known:
            return record['id'], {'status': 'already_published', 'checked_at': now()}
        try:
            host = urlsplit(record['candidate']['canonical_url']).hostname
            with locks[host]:
                if host not in webs:
                    webs[host] = web_factory() if web_factory else SafeWeb(delay=.5, max_pages=3)
                draft = assess(record['candidate'], webs[host])
            return record['id'], {'status': 'draft', 'draft': draft, 'checked_at': now()}
        except (FetchError, ValueError) as error:
            return record['id'], {'status': 'held', 'reason': str(error)[:200], 'temporary': isinstance(error, FetchError) and error.temporary, 'checked_at': now()}

    by_id = {record['id']: record for record in state['records']}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for key, update in executor.map(check, pending):
            by_id[key].update(update)
            persist(state)
    return len(pending)



def audit_saved_drafts(state):
    """Apply stronger review rules to drafts from earlier pipeline versions, offline."""
    changed = 0
    for record in state['records']:
        if record['status'] != 'draft':
            continue
        draft = record['draft']
        product = draft['product']
        reason = identity_review_reason(record['candidate'], product['name'], draft.get('identity_page_title', ''), draft.get('identity_site_name', ''))
        if not reason and not web_availability(draft['web_evidence_text']):
            reason = 'Web/SaaS availability excerpt needs explicit affirmative evidence'
        if reason:
            pass
        elif urlsplit(canonicalize(draft['web_evidence_url'])).hostname != urlsplit(canonicalize(record['candidate']['canonical_url'])).hostname:
            reason = 'Cross-host redirect requires manual official-identity review'
        elif product['verification_scope'] == 'capabilities':
            claims = [claim for claim in product['capabilities'] if reviewable_claim(claim)]
            if not claims:
                reason = 'Capability excerpts require manual editorial review'
            elif claims != product['capabilities']:
                product['capabilities'] = claims
                product['category_slug'] = CAPABILITIES[claims[0]['slug']]['category']
                product['short_description'] = product['name'] + ' provides ' + ', '.join(CAPABILITIES[claim['slug']]['name'].lower() for claim in claims[:3]) + '.'
                changed += 1
        if not reason and product['verification_scope'] == 'capabilities':
            identity_only(draft)
            changed += 1
        if reason:
            record.update(status='held', reason=reason, temporary=False, checked_at=now())
            del record['draft']
            changed += 1
    return changed


def summary(state):
    records = state['records']
    drafts = [record for record in records if record['status'] == 'draft']
    return {'total_unique_candidates': len(records), 'publication_drafts': len(drafts),
        'capability_drafts': sum(record['draft']['product']['verification_scope'] == 'capabilities' for record in drafts),
        'identity_drafts': sum(record['draft']['product']['verification_scope'] == 'identity' for record in drafts),
        'held': sum(record['status'] == 'held' for record in records),
        'pending': sum(record['status'] == 'pending' for record in records),
        'already_published': sum(record['status'] == 'already_published' for record in records), 'published': 0}


def run(args):
    if not 1 <= args.max_candidates <= 1000 or not 0 <= args.max_verify <= 200 or not 1 <= args.windows <= 30 or not 1 <= args.workers <= 8 or not 1 <= args.lookback_days <= 365:
        raise ValueError('Bounds: candidates 1..1000, verify 0..200, windows 1..30, workers 1..8, lookback 1..365 days')
    state_path = private_path(args.state)
    output_path = private_path(args.output)
    if state_path == output_path:
        raise ValueError('Journal and draft output paths must differ')
    snapshot = json.loads(Path(args.snapshot).read_text())
    state = json.loads(state_path.read_text()) if state_path.exists() else new_state(args.lookback_days)
    if state.get('version') != 1:
        raise ValueError('Unsupported offline discovery journal version')
    persist = lambda value: save_private(state_path, value)
    run_record = {'started_at': now(), 'snapshot_exported_at': snapshot.get('exported_at'),
                  'snapshot_products': len(snapshot['products']), 'status': 'running'}
    state['runs'].append(run_record)
    persist(state)
    if args.verify_only:
        run_record['collection'] = None
    else:
        run_record['collection'] = collect(state, snapshot, Sources(SafeWeb(delay=.5)), args.max_candidates, args.windows, persist)
    run_record['checked_this_run'] = verify_pending(state, snapshot, args.max_verify, args.workers, persist)
    run_record['drafts_reaudited'] = audit_saved_drafts(state)
    run_record.update(completed_at=now(), status='complete', summary=summary(state))
    persist(state)
    save_private(output_path, {'prepared_at': now(), 'snapshot_exported_at': snapshot.get('exported_at'),
        'review_required': True, 'published': False, 'summary': summary(state),
        'drafts': [record['draft'] for record in state['records'] if record['status'] == 'draft']})
    print(json.dumps(run_record, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', default=str(ROOT / 'data/seeds/published-snapshot.json'))
    parser.add_argument('--state', default=str(PRIVATE_ROOT / 'offline-discovery.json'))
    parser.add_argument('--output', default=str(PRIVATE_ROOT / 'offline-discovery-drafts.json'))
    parser.add_argument('--lookback-days', type=int, default=30, help='Initial cursor only; later runs resume the private journal')
    parser.add_argument('--max-candidates', type=int, default=100)
    parser.add_argument('--max-verify', type=int, default=50)
    parser.add_argument('--windows', type=int, default=7, help='Maximum day windows per source')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        with journal_lock(args.state):
            raise SystemExit(run(args))
    except (FetchError, ValueError, OSError) as error:
        parser.exit(1, type(error).__name__ + ': ' + str(error)[:200] + '\n')


if __name__ == '__main__':
    main()
