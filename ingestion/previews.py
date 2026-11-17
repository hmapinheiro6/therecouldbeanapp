"""Bounded public metadata thumbnails. No browser, paid service, D1 writes, or private queue."""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import re
import time
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlsplit
from PIL import Image, ImageOps
from .extraction import Metadata, ROOT, now
from .preview_metadata import preview_metadata
from .public_catalog import published_products, snapshot_products
from .safe_web import SafeWeb, FetchError, canonicalize

DIRECTORY = ROOT / 'public/catalog-previews'
MAX_FILE_BYTES = 48 * 1024
MAX_IMAGE_BYTES = 24 * 1024
MAX_FILES = 4000
MAX_TOTAL_BYTES = 128 * 1024 * 1024
SITE = 'https://therecouldbeanapp.henriquepinheiro.workers.dev'
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*\Z')


def thumbnail(payload):
    if not payload or len(payload) > 1024 * 1024:
        raise ValueError('Image input exceeds byte budget')
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(payload)) as image:
            if image.format not in {'JPEG', 'PNG', 'WEBP', 'ICO', 'AVIF'} or image.width * image.height > 12_000_000:
                raise ValueError('Unsupported or oversized raster image')
            image.seek(0)
            if image.width < 16 or image.height < 16:
                raise ValueError('Tracking-sized images are not useful previews')
            rgba = ImageOps.exif_transpose(image).convert('RGBA')
            image = Image.new('RGB', rgba.size, (240, 243, 237))
            image.paste(rgba, mask=rgba.getchannel('A'))
            for size, quality in [((480, 300), 65), ((480, 300), 45), ((360, 225), 40), ((240, 150), 30)]:
                image.thumbnail(size)
                output = io.BytesIO()
                image.save(output, format='WEBP', quality=quality, method=4)
                data = output.getvalue()
                if len(data) <= MAX_IMAGE_BYTES:
                    return {'data': 'data:image/webp;base64,' + base64.b64encode(data).decode(),
                            'width': image.width, 'height': image.height}
    raise ValueError('Image cannot fit the thumbnail budget')


def collect_preview(product, web=None):
    web = web or SafeWeb(delay=1, max_pages=3, max_bytes=1024 * 1024)
    page = web.fetch(product['canonical_url'])
    if page['status'] != 200 or 'html' not in page.get('content_type', '').lower():
        raise ValueError('No public HTML metadata')
    if urlsplit(canonicalize(page['url'])).hostname != urlsplit(canonicalize(product['canonical_url'])).hostname:
        raise ValueError('Cross-host product identity needs review')
    parser = Metadata()
    parser.feed(page['text'])
    metadata = preview_metadata(parser, page['url'])
    record = {'version': 1, 'slug': product['slug'], 'canonical_url': product['canonical_url'],
              'source_url': page['url'], 'checked_at': now(), 'title': metadata['title'],
              'description': metadata['description'], 'image': None}
    try:
        from .intelligence import observe_preview
        observe_preview(product, page, parser)
    except (OSError, ValueError, TypeError, KeyError):
        pass
    # At most two public raster candidates; image failures never lose metadata.
    for candidate in metadata['images']:
        try:
            image = web.fetch(candidate['url'])
            if image['status'] != 200 or not image.get('content_type', '').lower().startswith('image/'):
                continue
            record['image'] = {**thumbnail(image.get('body', b'')), 'kind': candidate['kind'],
                               'alt': metadata['image_alt'] if candidate['kind'] != 'icon' else '',
                               'source_url': image['url']}
            break
        except (ValueError, FetchError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            continue
    return record



def save_record(path, record):
    encoded = (json.dumps(record, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
    if len(encoded) > MAX_FILE_BYTES and record.get('image'):
        record = {**record, 'image': None}
        encoded = (json.dumps(record, ensure_ascii=True, separators=(',', ':')) + '\n').encode()
    if len(encoded) > MAX_FILE_BYTES:
        raise ValueError('Preview record exceeds budget')
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(encoded)
    temporary.replace(path)


def run(limit=40, workers=4, directory=DIRECTORY, products=None, web_factory=SafeWeb):
    if not 1 <= limit <= 100 or not 1 <= workers <= 4:
        raise ValueError('Preview batch bounds exceeded')
    directory.mkdir(parents=True, exist_ok=True)
    files = list(directory.glob('*.json'))
    if len(files) > MAX_FILES or sum(p.stat().st_size for p in files) > MAX_TOTAL_BYTES:
        raise ValueError('Preview storage budget reached')
    products = products if products is not None else published_products(web_factory(delay=1, max_pages=3), snapshot_products(), directory)
    eligible = []
    stamp = datetime.now(timezone.utc)
    for product in products:
        slug = product.get('slug', '')
        if not isinstance(slug, str) or len(slug) > 100 or not SLUG.fullmatch(slug):
            continue
        try:
            canonicalize(product['canonical_url'])
            path = directory / (slug + '.json')
            previous = json.loads(path.read_text()) if path.exists() else None
            age = stamp - datetime.fromisoformat((previous.get('attempted_at') or previous['checked_at']).replace('Z', '+00:00')) if previous else timedelta(days=999)
            if previous and previous['canonical_url'] == product['canonical_url'] and age < timedelta(days=7 if previous.get('error') else 30):
                continue
            # First pass covers capability-verified products, then the remaining publication backlog.
            priority = (0 if not previous else 1, 0 if product.get('verification_scope') == 'capabilities' else 1,
                        (previous.get('attempted_at') or previous['checked_at']) if previous else '', product.get('first_seen_at', ''), slug)
            eligible.append((priority, product, path, previous))
        except (ValueError, KeyError, TypeError):
            continue
    selected = []
    capacity = MAX_FILES - len(files)
    for item in sorted(eligible, key=lambda item: item[0]):
        if not item[2].exists():
            if capacity <= 0:
                continue
            capacity -= 1
        selected.append(item)
        if len(selected) == limit:
            break
    summary = {'checked': 0, 'images': 0, 'metadata_only': 0, 'failed': 0, 'execution': 'github-hosted' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'local-verification', 'd1_writes': 0}
    deadline = time.monotonic() + 8 * 60
    def check(item):
        _, product, path, previous = item
        if time.monotonic() >= deadline:
            return None
        try:
            record = collect_preview(product, web_factory(delay=1, max_pages=3, max_bytes=1024 * 1024))
        except Exception:
            # Keep the true collection date when preserving earlier usable metadata.
            usable = previous if previous and previous['canonical_url'] == product['canonical_url'] else None
            record = {**(usable or {'version': 1, 'slug': product['slug'], 'canonical_url': product['canonical_url'],
                                     'source_url': product['canonical_url'], 'title': '', 'description': '', 'image': None, 'checked_at': now()}),
                      'attempted_at': now(), 'error': 'metadata_unavailable'}
        return path, record
    total_bytes = sum(p.stat().st_size for p in files)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for future in as_completed([pool.submit(check, item) for item in selected]):
            result = future.result()
            if not result:
                continue
            path, record = result
            encoded_size = len(json.dumps(record, ensure_ascii=True, separators=(',', ':')).encode()) + 1
            total_bytes += encoded_size - (path.stat().st_size if path.exists() else 0)
            if total_bytes > MAX_TOTAL_BYTES:
                raise ValueError('Preview storage budget reached')
            save_record(path, record)
            summary['checked'] += 1
            summary['images' if record.get('image') else 'failed' if record.get('error') else 'metadata_only'] += 1
    summary['stored_bytes'] = total_bytes
    print(json.dumps(summary))
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with Path(os.environ['GITHUB_STEP_SUMMARY']).open('a') as handle:
            handle.write('\n## Publisher previews\n\n' + json.dumps(summary) + '\n\nPublic published products only. Preview failures do not change catalog identity, features or discovery.\n')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=40)
    args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Production preview collection runs in the hosted workflow')
    run(args.limit)


if __name__ == '__main__':
    main()
