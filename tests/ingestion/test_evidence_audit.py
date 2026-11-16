import json
import stat
from copy import deepcopy
from unittest.mock import Mock

import pytest

from ingestion import evidence_audit as audit
from ingestion.safe_web import FetchError


def product(name='ActualApp', url='https://actual.dev'):
    return {'slug': 'stable-original-slug', 'name': name, 'canonical_url': url,
            'short_description': name + ': Project management software.',
            'category_slug': 'web-apps', 'audience': 'Self-hosted software users',
            'verification_scope': 'identity', 'capabilities': [],
            'identity_evidence_url': url, 'identity_evidence_text': name,
            'first_seen_at': '2020-01-01T00:00:00Z',
            'last_verified_at': '2020-01-01T00:00:00Z',
            'url_aliases': ['https://actual.dev/old'], 'search_aliases': 'Actual',
            'sources': [{'source_name': 'Licensed directory', 'source_url': 'https://source.dev'}]}


def web(text=None):
    mock = Mock()
    mock.fetch.return_value = {
        'status': 200, 'content_type': 'text/html', 'url': 'https://actual.dev',
        'text': text or '<title>ActualApp</title><p>ActualApp provides project management software for teams to organize work and track their projects.</p>',
    }
    return mock


def test_drafts_preserve_identity_provenance_and_require_review():
    original = product()
    unchanged = deepcopy(original)
    result = audit.prepare_draft(original, web())
    assert original == unchanged
    draft = result['product']
    for key in ('slug', 'canonical_url', 'sources', 'first_seen_at', 'url_aliases', 'search_aliases', 'short_description'):
        assert draft[key] == original[key]
    assert result['publication_status'] == 'unpublished_draft'
    assert result['review_status'] == 'needs_operator_review'
    claim = draft['capabilities'][0]
    assert claim['slug'] == 'projects'
    assert claim['evidence_text'] == 'ActualApp provides project management software for teams to organize work and track their projects'
    assert claim['evidence_url'] == 'https://actual.dev'
    assert claim['verified_at']
    assert len(result['official_page']['content_sha256']) == 64


def test_directory_description_never_substitutes_for_official_feature_evidence():
    with pytest.raises(FetchError, match='capability evidence'):
        audit.prepare_draft(product(), web('<title>ActualApp</title><p>ActualApp is an application that is available to download today. Please read the documentation for more information about our software.</p>'))


def test_external_redirect_is_held_without_claiming_ownership():
    client = web()
    client.fetch.return_value['url'] = 'https://different.dev'
    with pytest.raises(FetchError, match='different hostname'):
        audit.prepare_draft(product(), client)


def test_www_redirect_preserves_official_identity():
    client = web()
    client.fetch.return_value['url'] = 'https://www.actual.dev/'
    assert audit.prepare_draft(product(), client)['product']['capabilities'][0]['evidence_url'] == 'https://www.actual.dev/'


def test_resume_skips_attempted_products_and_keeps_files_private(tmp_path, monkeypatch):
    private = tmp_path / '.ingestion-state'
    monkeypatch.setattr(audit, 'PRIVATE_ROOT', private)
    snapshot = tmp_path / 'snapshot.json'
    snapshot.write_text(json.dumps({'exported_at': '2026-11-16T00:00:00Z', 'products': [product()]}))
    client = web()
    first = audit.run(snapshot, private / 'batch', limit=1, workers=1, web_factory=lambda: client)
    second = audit.run(snapshot, private / 'batch', limit=1, workers=1, web_factory=lambda: client)
    assert first['checked'] == first['prepared_drafts'] == 1
    assert second['newly_checked'] == 0
    assert second['published'] == 0
    assert client.fetch.call_count == 1
    assert stat.S_IMODE((private / 'batch/checkpoint.json').stat().st_mode) == 0o600
    assert stat.S_IMODE((private / 'batch').stat().st_mode) == 0o700
    snapshot.write_text(snapshot.read_text() + ' ')
    with pytest.raises(ValueError, match='Snapshot changed'):
        audit.run(snapshot, private / 'batch', web_factory=lambda: client)


def test_held_failure_is_checkpointed_without_database_or_public_draft(tmp_path, monkeypatch):
    private = tmp_path / '.ingestion-state'
    monkeypatch.setattr(audit, 'PRIVATE_ROOT', private)
    snapshot = tmp_path / 'snapshot.json'
    snapshot.write_text(json.dumps({'products': [product()]}))
    client = web()
    client.fetch.side_effect = FetchError('robots.txt disallows access', False)
    result = audit.run(snapshot, private / 'batch', workers=1, web_factory=lambda: client)
    assert result['held'] == result['checked'] == 1
    assert result['prepared_drafts'] == result['proposed_claims'] == result['published'] == 0
    assert json.loads((private / 'batch/drafts.json').read_text())['drafts'] == []


def test_public_output_path_is_refused_before_fetch(tmp_path):
    with pytest.raises(ValueError, match='ignored'):
        audit.run(tmp_path / 'absent.json', tmp_path / 'public')


def test_triage_only_selects_identity_web_apps_and_prefers_official_sites():
    desktop = {**product('Desktop'), 'category_slug': 'desktop-apps'}
    verified = {**product('Verified'), 'verification_scope': 'capabilities'}
    repository = product('Repo', 'https://github.com/maker/repo')
    assert audit.prioritize([desktop, verified, repository, product()]) == [product(), repository]


@pytest.mark.parametrize('slug,text', [
    ('crm', 'Connect payments, analytics, CRM, and automation to your form'),
    ('crm', 'Get started with Frappe CRM software for your business'),
    ('projects', "I'm Andrej, and I created Kaneo because I was tired of project management tools"),
    ('invoicing', 'EGroupware will offer an application for mandatory e-invoicing in Germany'),
    ('hosting', "I found your project and want to deploy it to my web hosting"),
    ('design', 'Free online database schema design tool for every database'),
    ('remote-access', 'Meet face to face with video, audio, and screen sharing'),
    ('code-hosting', 'Learn more about our distributed version control software'),
    ('education', 'Your Higher Education Guide to Choosing a Learning Management System'),
    ('docs', 'Knowledge Base'),
    ('education', 'BigBlueButton has been deeply embedded into major learning management systems used worldwide'),
    ('ai-chat', 'An open source plugin for Datasette that provides an AI assistant'),
    ('uptime', 'breaking_news Error Tracking avg_pace Performance Monitoring share_eta Uptime Monitoring'),
    ('file-sync', 'Sync files with your team via Google Drive, Dropbox, or Syncthing'),
    ('projects', 'Coming soon: project management software for all your team projects'),
    ('projects', 'Upcoming project management software to organize all your projects'),
    ('projects', 'Not yet available: project management software for all your projects'),
])
def test_ambiguous_labels_promises_integrations_and_other_features_are_not_prepared(slug, text):
    assert not audit.reviewable_claim({'slug': slug, 'evidence_text': text})
