"""Bounded already-published identities for public enrichment jobs."""
import json
from .extraction import ROOT
from .safe_web import FetchError, canonicalize
import re
MAX_PRODUCTS = 4000
SITE = "https://therecouldbeanapp.henriquepinheiro.workers.dev"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")

def snapshot_products():
    return json.loads((ROOT / 'data/seeds/published-snapshot.json').read_text())['products']


def published_products(web, snapshot, directory):
    """Durable, forward-only public IDs retain every approved entry across bounded runs."""
    index_file = directory / '.catalog-index.json'
    state = json.loads(index_file.read_text()) if index_file.exists() and index_file.stat().st_size <= 2 * 1024 * 1024 else {'after': 0, 'products': []}
    products = {p['slug']: p for p in [*snapshot, *state['products']]}
    after = int(state.get('after', 0))
    for _ in range(3):
        try:
            response = web.fetch(SITE + '/api/preview-products?after=' + str(after))
            if response['status'] != 200:
                break
            data = json.loads(response['text'])
            incoming = data.get('products', [])
            next_after = data.get('next_after')
            if not isinstance(incoming, list) or len(incoming) > 100 or not isinstance(next_after, int) or next_after < after:
                break
            for product in incoming:
                slug = product.get('slug', '')
                if not isinstance(slug, str) or len(slug) > 100 or not SLUG.fullmatch(slug):
                    continue
                canonicalize(product['canonical_url'])
                if slug not in products and len(products) >= MAX_PRODUCTS:
                    raise ValueError('Published preview index budget reached')
                products[slug] = {key: product[key] for key in ('slug', 'name', 'canonical_url', 'verification_scope', 'first_seen_at') if key in product}
            after = next_after
            if not data.get('has_more'):
                break
        except (ValueError, FetchError, OSError, KeyError, TypeError):
            break
    # Only minimal already-public identity fields; never review queues or secrets.
    indexed = [{key: product[key] for key in ('slug', 'name', 'canonical_url', 'verification_scope', 'first_seen_at') if key in product} for product in products.values()]
    encoded = json.dumps({'after': after, 'products': indexed}, ensure_ascii=True, separators=(',', ':')) + '\n'
    if len(encoded.encode()) > 2 * 1024 * 1024:
        raise ValueError('Published index byte budget reached')
    temporary = index_file.with_suffix('.tmp')
    temporary.write_text(encoded)
    temporary.replace(index_file)
    return list(products.values())

