"""Small publisher-authored preview fields; never evidence of product capabilities."""
import re
from urllib.parse import urljoin, urlsplit, urlunsplit
from .safe_web import canonicalize


def plain(value, limit):
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>|[<>\x00-\x1f\x7f]', ' ', value or '')).strip()
    return text.encode('utf-16-le')[:limit * 2].decode('utf-16-le', errors='ignore')


def image_url(value, base):
    try:
        absolute = urljoin(base, value.strip())
        canonicalize(absolute, keep_www=True)
        url = urlsplit(absolute)
        # Retain public CDN signatures exactly; only remove fragments.
        result = urlunsplit((url.scheme, url.netloc, url.path, url.query, ''))
        return result if len(result) <= 2000 and value.strip() else None
    except (ValueError, TypeError):
        return None


def preview_metadata(parser, page_url):
    meta = parser.meta
    title = plain(meta.get('og:title') or meta.get('twitter:title') or parser.title, 160)
    description = plain(meta.get('og:description') or meta.get('twitter:description') or meta.get('description'), 280)
    images = []
    for kind, value in [('og:image', meta.get('og:image:secure_url') or meta.get('og:image') or meta.get('og:image:url')),
                        ('twitter:image', meta.get('twitter:image') or meta.get('twitter:image:src')),
                        *[('icon', value) for value in getattr(parser, 'icons', [])[:2]]]:
        url = image_url(value or '', page_url)
        if url and url not in [i['url'] for i in images]:
            images.append({'kind': kind, 'url': url})
    return {'title': title, 'description': description, 'images': images[:2],
            'image_alt': plain(meta.get('og:image:alt') or meta.get('twitter:image:alt'), 160)}
