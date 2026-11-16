"""Prepare private, resumable official-feature review drafts without any database access.

Directory text only prioritizes the work; every proposed claim is extracted from a
fresh official page. Nothing in this module approves or publishes a product.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from urllib.parse import urlsplit

from .extraction import evidence_from, now, verify
from .safe_web import FetchError, SafeWeb, canonicalize

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = ROOT / '.ingestion-state'
POLICY_VERSION = 3


def private_json(path, value):
    """Replace checkpoints atomically, creating files with owner-only access."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def product_key(product):
    return canonicalize(product['canonical_url'])


def prioritize(products):
    """Use directory descriptions as triage hints, never as feature evidence."""
    eligible = [p for p in products if p.get('verification_scope') == 'identity'
                and p.get('category_slug') == 'web-apps' and not p.get('capabilities')]
    # Official product sites precede repository/readme pages. Equal scores have a
    # stable order, making a resumed batch deterministic.
    def order(product):
        host = urlsplit(product_key(product)).hostname
        hints = len(evidence_from([product.get('short_description', '')]))
        return (host in ('github.com', 'gitlab.com'), -min(hints, 2), product['name'].casefold())
    return sorted(eligible, key=order)


class RecordingWeb:
    def __init__(self, web):
        self.web = web
        self.page = None

    def fetch(self, url):
        self.page = self.web.fetch(url)
        requested = urlsplit(url).hostname.removeprefix('www.')
        received = urlsplit(self.page['url']).hostname.removeprefix('www.')
        if requested != received:
            raise FetchError('Official site redirected to a different hostname; review identity manually', False)
        return self.page


def reviewable_claim(claim):
    """Audit-only precision gate; search/discovery vocabulary is much broader."""
    text = claim['evidence_text']
    if len(re.findall(r"[\w'-]+", text)) < 6:
        return False
    # Short labels, quotes, related-product promotions, promises, and integration
    # destinations cannot establish an affirmative feature of this product.
    if re.search(r"\b(I|I'm|I've|my|we were|we feel|will offer|will support|will provide|planned|roadmap|coming soon|not yet|upcoming|guide to|choosing a|get started with)\b", text, re.I):
        return False
    if re.search(r'\b(connect(?:s|ing)?|integrat\w*)\b', text, re.I):
        return False
    if re.search(r'\b(embedded into|plugin for|compatible with)\b|[a-z]+_[a-z]+', text, re.I):
        return False
    slug = claim['slug']
    if slug == 'design' and not re.search(r'\b(interface|wirefram\w*|UI|UX)\b', text, re.I):
        return False
    if slug == 'remote-access' and not re.search(r'\b(remote (?:access|desktop)|control (?:your |a |the )?(?:computer|desktop))\b', text, re.I):
        return False
    if slug == 'code-hosting' and not re.search(r'\b(code hosting|git repositories|repository hosting|host\w* (?:git |code )?repositor\w*)\b', text, re.I):
        return False
    if slug == 'crm' and not re.search(r'\b(CRM (?:software|platform)|customer relationship management|(?:manage\w*|management of) (?:your |the )?(?:clients|customers|contacts))\b', text, re.I):
        return False
    if slug == 'file-sync' and re.search(r'\bvia\b', text, re.I):
        return False
    return True


def prepare_draft(product, web):
    recorded = RecordingWeb(web)
    # Non-curated extraction is intentional: existing category/description hints
    # must not bypass the conservative official-feature evidence guards.
    fresh = verify(product, recorded)
    retained = [claim for claim in fresh['capabilities'] if reviewable_claim(claim)]
    discarded = [claim for claim in fresh['capabilities'] if not reviewable_claim(claim)]
    if not retained:
        raise FetchError('No unambiguous explanatory feature evidence after audit precision checks', False)
    draft = deepcopy(product)
    draft.update(verification_scope='capabilities', capabilities=retained,
                 last_verified_at=fresh['last_verified_at'])
    # Existing names, editorial descriptions, categories, dates, URL aliases and
    # complete source provenance are retained for the operator to review.
    page = recorded.page
    return {
        'review_status': 'needs_operator_review',
        'publication_status': 'unpublished_draft',
        'checked_at': fresh['last_verified_at'],
        'product': draft,
        'discarded_claims': discarded,
        'official_page': {
            'requested_url': product_key(product),
            'final_url': page['url'],
            'content_sha256': hashlib.sha256(page['text'].encode()).hexdigest(),
            'content_type': page['content_type'],
        },
        'review_instructions': 'Open every cited official page and confirm each excerpt describes this product before approving. No catalog change has been made.',
    }


def summary_for(state, newly_checked=0):
    results = list(state['results'].values())
    prepared = [r for r in results if r['status'] == 'prepared']
    return {
        'snapshot_sha256': state['snapshot_sha256'],
        'snapshot_exported_at': state['snapshot_exported_at'],
        'policy_version': state['policy_version'],
        'newly_checked': newly_checked,
        'checked': len(results),
        'prepared_drafts': len(prepared),
        'held': sum(r['status'] == 'held' for r in results),
        'proposed_claims': sum(len(r['draft']['product']['capabilities']) for r in prepared),
        'published': 0,
        'completed_at': now(),
    }


def run(snapshot, output, limit=40, workers=4, max_seconds=300, web_factory=None):
    snapshot, output = Path(snapshot), Path(output).resolve()
    private_root = PRIVATE_ROOT.resolve()
    if not output.is_relative_to(private_root) or output == private_root:
        raise ValueError('Evidence audit output must be a directory within ignored .ingestion-state/')
    raw = snapshot.read_bytes()
    exported = json.loads(raw)
    fingerprint = hashlib.sha256(raw).hexdigest()
    checkpoint = output / 'checkpoint.json'
    if checkpoint.exists():
        state = json.loads(checkpoint.read_text())
        if state.get('snapshot_sha256') != fingerprint:
            raise ValueError('Snapshot changed; use a new private output directory')
        if state.get('policy_version') != POLICY_VERSION:
            raise ValueError('Evidence policy changed; use a new private output directory')
    else:
        state = {'version': 1, 'policy_version': POLICY_VERSION, 'snapshot_sha256': fingerprint,
                 'snapshot_exported_at': exported.get('exported_at'),
                 'started_at': now(), 'results': {}}
    selected = []
    seen = set(state['results'])
    for product in prioritize(exported['products']):
        key = product_key(product)
        if key not in seen:
            selected.append(product)
            seen.add(key)
        if len(selected) >= limit:
            break
    web_factory = web_factory or (lambda: SafeWeb(delay=1, max_pages=3))
    hosts = {urlsplit(product_key(p)).hostname for p in selected}
    host_locks = {host: threading.Lock() for host in hosts}
    host_web = {host: web_factory() for host in hosts}
    started = time.monotonic()

    def check(product):
        host = urlsplit(product_key(product)).hostname
        with host_locks[host]:
            if time.monotonic() - started >= max_seconds:
                return None
            try:
                return {'status': 'prepared', 'draft': prepare_draft(product, host_web[host])}
            except (ValueError, FetchError, TypeError, KeyError, UnicodeError, RecursionError) as error:
                return {'status': 'held', 'name': product['name'],
                        'slug': product['slug'], 'canonical_url': product_key(product),
                        'checked_at': now(), 'reason': str(error)[:300],
                        'temporary': bool(isinstance(error, FetchError) and error.temporary)}

    checked = 0
    with ThreadPoolExecutor(max_workers=workers) as executor:
        pending = {executor.submit(check, p): p for p in selected}
        for future in as_completed(pending):
            result = future.result()
            if result is None:
                continue
            state['results'][product_key(pending[future])] = result
            checked += 1
            private_json(checkpoint, state)
    summary = summary_for(state, checked)
    private_json(output / 'drafts.json', {
        'summary': summary,
        'drafts': [r['draft'] for r in state['results'].values() if r['status'] == 'prepared'],
        'held': [r for r in state['results'].values() if r['status'] == 'held'],
    })
    private_json(output / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'data/seeds/published-snapshot.json')
    parser.add_argument('--output', type=Path, default=PRIVATE_ROOT / 'evidence-audit')
    parser.add_argument('--limit', type=int, default=40, help='Maximum new products checked in this invocation')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-seconds', type=int, default=300, help='Stop starting new checks after this duration; in-flight bounded requests finish')
    args = parser.parse_args()
    if not 1 <= args.limit <= 200 or not 1 <= args.workers <= 8 or not 1 <= args.max_seconds <= 900:
        parser.error('Use 1–200 products, 1–8 workers, and 1–900 seconds')
    print(json.dumps(run(args.snapshot, args.output, args.limit, args.workers, args.max_seconds), indent=2))


if __name__ == '__main__':
    main()
