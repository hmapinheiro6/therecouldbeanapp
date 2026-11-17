"""Bounded already-published identities for public enrichment jobs."""
import json
from .extraction import ROOT
from .safe_web import canonicalize
import re
MAX_PRODUCTS = 12000
SITE = "https://therecouldbeanapp.henriquepinheiro.workers.dev"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")

def snapshot_products():
    return json.loads((ROOT / 'data/seeds/published-snapshot.json').read_text())['products']


def published_products(web, snapshot, directory):
    """Durable, forward-only public IDs retain every approved entry across bounded runs."""
    # The same authoritative published export drives the website and enrichment.
    # Do not merge an old per-job index: an unpublished product must stay absent.
    products = []
    seen = set()
    for product in snapshot:
        slug = product.get('slug', '')
        if not isinstance(slug, str) or len(slug) > 100 or not SLUG.fullmatch(slug) or slug in seen:
            raise ValueError('Invalid published catalog identity')
        canonicalize(product['canonical_url'])
        seen.add(slug)
        products.append(product)
    if len(products) > MAX_PRODUCTS:
        raise ValueError('Published catalog budget reached')
    return products
