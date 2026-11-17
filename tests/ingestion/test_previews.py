import base64
from datetime import datetime, timedelta, timezone
import io
import json
from unittest.mock import Mock
import pytest
from PIL import Image
from ingestion.extraction import Metadata
from ingestion.preview_metadata import preview_metadata
from ingestion.previews import thumbnail, collect_preview, run, MAX_IMAGE_BYTES, MAX_FILE_BYTES
from ingestion.safe_web import FetchError

PRODUCT = {'slug': 'actual', 'canonical_url': 'https://actual.dev', 'verification_scope': 'capabilities'}


@pytest.fixture(autouse=True)
def isolate_observations(tmp_path, monkeypatch):
    monkeypatch.setattr('ingestion.intelligence.DIRECTORY', tmp_path / 'observations')


def png(size=(1000, 700)):
    output = io.BytesIO()
    Image.new('RGB', size, 'blue').save(output, format='PNG')
    return output.getvalue()


def page(extra=''):
    return {'status': 200, 'content_type': 'text/html', 'url': 'https://actual.dev/',
            'text': '<title>SEO title</title><meta property="og:title" content="Publisher title"><meta name="description" content="Fallback"><meta property="og:description" content="Publisher &amp; details">' + extra}


def test_standard_metadata_fallbacks_first_image_and_relative_urls():
    parser = Metadata()
    parser.feed(page('<meta property="og:image" content="/first.png"><meta property="og:image" content="https://second.dev/image"><meta name="twitter:image" content="https://cdn.dev/image?signature=z&amp;a=1"><link rel="icon" href="/icon.ico">')['text'])
    result = preview_metadata(parser, 'https://actual.dev/')
    assert result['title'] == 'Publisher title'
    assert result['description'] == 'Publisher & details'
    assert result['images'] == [{'kind': 'og:image', 'url': 'https://actual.dev/first.png'}, {'kind': 'twitter:image', 'url': 'https://cdn.dev/image?signature=z&a=1'}]
    assert len(result['images']) == 2


def test_unsafe_images_and_markup_are_rejected_without_affecting_other_metadata():
    parser = Metadata()
    parser.feed('<title>Useful &lt;b&gt;tool&lt;/b&gt;</title><meta property="og:image" content="javascript:alert(1)"><meta name="twitter:image" content="https://127.0.0.1/a"><link rel="icon" href="https://private.internal/icon">')
    result = preview_metadata(parser, 'https://actual.dev')
    assert result['images'] == []
    assert result['title'] == 'Useful tool'


def test_metadata_obeys_utf16_limits_and_does_not_include_private_page_body():
    parser = Metadata()
    parser.feed('<title>' + '😀' * 200 + '</title><p>Private-looking page content never becomes preview text</p>')
    result = preview_metadata(parser, 'https://actual.dev')
    assert len(result['title'].encode('utf-16-le')) <= 320
    assert result['description'] == ''


def test_raster_is_reencoded_without_metadata_and_fits_fixed_budgets():
    result = thumbnail(png())
    data = base64.b64decode(result['data'].split(',')[1])
    assert len(data) <= MAX_IMAGE_BYTES
    assert result['width'] <= 480 and result['height'] <= 300
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == 'WEBP'
        assert 'exif' not in image.info


@pytest.mark.parametrize('body', [b'<svg onload="alert(1)"></svg>', b'<html>not an image</html>', b'a' * (1024 * 1024 + 1)])
def test_active_invalid_and_oversized_images_are_not_accepted(body):
    with pytest.raises((ValueError, OSError)):
        thumbnail(body)


def test_one_html_fetch_produces_metadata_and_a_thumbnail_without_publishing_features():
    web = Mock()
    web.fetch.side_effect = [page('<meta property="og:image" content="/sharing.png">'), {'status': 200, 'content_type': 'image/png', 'body': png(), 'url': 'https://actual.dev/sharing.png'}]
    result = collect_preview(PRODUCT, web)
    assert web.fetch.call_count == 2
    assert result['image']['kind'] == 'og:image'
    assert result['canonical_url'] == PRODUCT['canonical_url']
    assert 'capabilities' not in result and 'verification_scope' not in result


def test_image_failure_preserves_metadata_and_tries_only_the_bounded_fallback():
    web = Mock()
    web.fetch.side_effect = [page('<meta property="og:image" content="/sharing.png"><meta name="twitter:image" content="/other.png">'), FetchError('blocked', False), {'status': 403, 'content_type': 'text/html'}]
    result = collect_preview(PRODUCT, web)
    assert result['image'] is None and result['title'] == 'Publisher title'
    assert web.fetch.call_count == 3


def test_cross_host_redirect_does_not_mislabel_publisher_metadata():
    web = Mock()
    web.fetch.return_value = {**page(), 'url': 'https://different.dev/'}
    with pytest.raises(ValueError, match='identity'):
        collect_preview(PRODUCT, web)


def test_batches_skip_fresh_records_backoff_failures_and_preserve_usable_old_previews(tmp_path):
    path = tmp_path / 'actual.json'
    stamp = datetime.now(timezone.utc)
    old = {**PRODUCT, 'version': 1, 'source_url': PRODUCT['canonical_url'], 'title': 'Previously checked', 'description': 'Useful publisher text', 'checked_at': (stamp - timedelta(days=31)).isoformat(), 'image': None}
    path.write_text(json.dumps(old))
    web = Mock(); web.fetch.side_effect = FetchError('temporary')
    result = run(1, 1, tmp_path, [PRODUCT], lambda **_: web)
    assert result['failed'] == 1
    record = json.loads(path.read_text())
    assert record['title'] == old['title']
    assert record['checked_at'] == old['checked_at']
    assert record['attempted_at'] != old['checked_at']
    assert len(path.read_bytes()) <= MAX_FILE_BYTES
    result = run(1, 1, tmp_path, [PRODUCT], lambda **_: web)
    assert result['checked'] == 0
    assert web.fetch.call_count == 1
    assert not list(tmp_path.glob('*.tmp'))


def test_new_catalog_preview_is_presentation_only_and_batch_limit_is_hard(tmp_path):
    web = Mock(); web.fetch.return_value = page()
    products = [PRODUCT, {**PRODUCT, 'slug': 'another'}]
    result = run(1, 1, tmp_path, products, lambda **_: web)
    assert result['checked'] == 1 and result['d1_writes'] == 0
    assert len(list(tmp_path.glob('*.json'))) == 1
    assert web.fetch.call_count == 1


def test_forward_published_cursor_retains_backlog_without_relying_on_local_research(tmp_path):
    from ingestion.previews import published_products
    web = Mock()
    web.fetch.return_value = {'status': 200, 'text': json.dumps({'products': [{**PRODUCT, 'id': 10, 'name': 'Actual'}], 'next_after': 10, 'has_more': False})}
    assert published_products(web, [], tmp_path)[0]['slug'] == 'actual'
    assert json.loads((tmp_path / '.catalog-index.json').read_text())['after'] == 10
    web.fetch.side_effect = FetchError('D1 allowance paused')
    assert published_products(web, [], tmp_path)[0]['slug'] == 'actual'
    assert web.fetch.call_args.args[0].endswith('after=10')


def test_forward_index_limits_pages_and_drops_non_public_fields(tmp_path):
    from ingestion.previews import published_products
    web = Mock()
    web.fetch.return_value = {'status': 200, 'text': json.dumps({'products': [{**PRODUCT, 'contact_email': 'must-not-be-stored'}], 'next_after': 100, 'has_more': True})}
    published_products(web, [], tmp_path)
    assert web.fetch.call_count == 3
    assert 'contact_email' not in (tmp_path / '.catalog-index.json').read_text()
