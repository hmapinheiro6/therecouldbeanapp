import copy
import json
import os
from unittest.mock import Mock

import pytest

from ingestion import offline_discovery as offline
from ingestion.safe_web import FetchError


def candidate(name='ActualApp', url='https://actual.dev', external_id='1', source='Hacker News'):
    return {'name': name, 'canonical_url': url, 'source_name': source, 'source_type': 'hackernews',
        'source_url': 'https://news.ycombinator.com/item?id=' + external_id, 'external_id': external_id,
        'discovered_at': '2026-11-01T00:00:00Z', 'resolve_identity': True}


def page(body):
    return {'status': 200, 'content_type': 'text/html', 'url': 'https://actual.dev/',
        'text': '<title>ActualApp</title><p>ActualApp is a browser-based software application for everyday work.</p><p>' + body + '</p>'}


def test_collector_deduplicates_snapshot_aliases_and_cross_source_urls_before_website_fetch():
    snapshot = {'products': [{'canonical_url': 'https://known.dev', 'url_aliases': ['https://old.dev']} ]}
    state = offline.new_state(30)
    source = Mock()
    source.hackernews.return_value = ([candidate(url='https://www.old.dev/?utm_source=x'), candidate(external_id='2')], 'next-hn')
    source.github.return_value = ([candidate(external_id='3', source='GitHub')], 'next-gh')
    saved = []
    result = offline.collect(state, snapshot, source, 20, 1, lambda state: saved.append(copy.deepcopy(state)))
    assert result['new_candidates'] == 1
    assert result['duplicates'] == 4
    assert state['records'][0]['candidate']['name'] == 'ActualApp'
    # The first durable cursor already contains its matching lead.
    assert saved[0]['checkpoints']['hackernews'] == 'next-hn'
    assert len(saved[0]['records']) == 1


def test_failed_source_retains_its_cursor_and_allows_other_sources():
    state = offline.new_state(30)
    initial_cursor = state['checkpoints']['hackernews']
    source = Mock()
    source.hackernews.side_effect = FetchError('Source unavailable')
    source.github.return_value = ([], 'advanced')
    result = offline.collect(state, {'products': []}, source, 10, 2, lambda _: None)
    assert state['checkpoints']['hackernews'] == initial_cursor
    assert len(result['source_errors']) == 1
    assert source.hackernews.call_count == 1
    assert state['checkpoints']['github_saas'] == 'advanced'


def test_verified_web_features_remain_review_drafts_and_fetch_only_once():
    web = Mock()
    web.fetch.return_value = page('ActualApp provides project management software for planning team work and tracking delivery.')
    draft = offline.assess(candidate(), web)
    assert draft['published'] is False and draft['review_required'] is True
    assert draft['product']['verification_scope'] == 'identity'
    assert draft['product']['capabilities'] == []
    assert draft['unreviewed_feature_proposals'][0]['slug'] == 'projects'
    assert draft['product']['source']['source_url'].endswith('id=1')
    assert draft['web_evidence_url'] == 'https://actual.dev/'
    web.fetch.assert_called_once()


def test_identity_draft_does_not_invent_capabilities_when_taxonomy_lacks_feature():
    web = Mock()
    web.fetch.return_value = page('ActualApp turns your favorite colors into amusing abstract shapes that move around the screen.')
    draft = offline.assess(candidate(), web)
    assert draft['product']['verification_scope'] == 'identity'
    assert draft['product']['capabilities'] == []
    assert draft['product']['identity_evidence_url'] == 'https://actual.dev/'
    assert draft['product']['source']['source_name'] == 'Hacker News'


def test_desktop_only_or_unconfirmed_products_are_held():
    web = Mock()
    web.fetch.return_value = {'status': 200, 'content_type': 'text/html', 'url': 'https://actual.dev/',
        'text': '<title>ActualApp</title><p>ActualApp is software for project management and delivery. Download the macOS desktop application to start tracking your projects.</p>'}
    with pytest.raises(FetchError, match='web/SaaS'):
        offline.assess(candidate(), web)
    with pytest.raises(FetchError, match='name'):
        offline.assess(candidate(name='InventedName'), web)


def test_private_atomic_journal_cannot_be_saved_in_public_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(offline, 'PRIVATE_ROOT', tmp_path / '.ingestion-state')
    path = offline.PRIVATE_ROOT / 'journal.json'
    offline.save_private(path, {'records': [1]})
    offline.save_private(path, {'records': [2]})
    assert json.loads(path.read_text()) == {'records': [2]}
    assert os.stat(path).st_mode & 0o777 == 0o600
    assert os.stat(path.parent).st_mode & 0o777 == 0o700
    assert [p.name for p in path.parent.iterdir()] == ['journal.json']
    with pytest.raises(ValueError, match='must stay inside'):
        offline.save_private(tmp_path / 'public.json', {})


def test_resumed_pending_work_is_checked_against_latest_public_snapshot():
    c = candidate()
    record = {'id': offline.candidate_key(c), 'candidate': c, 'status': 'pending'}
    state = {'records': [record]}
    web_factory = Mock()
    checked = offline.verify_pending(state, {'products': [{'canonical_url': c['canonical_url']}]}, 10, 2, lambda _: None, web_factory)
    assert checked == 1
    assert record['status'] == 'already_published'
    web_factory.assert_not_called()
    assert offline.summary(state)['published'] == 0


def test_simultaneous_runs_cannot_overwrite_same_journal(tmp_path, monkeypatch):
    monkeypatch.setattr(offline, 'PRIVATE_ROOT', tmp_path / '.ingestion-state')
    path = offline.PRIVATE_ROOT / 'journal.json'
    with offline.journal_lock(path):
        with pytest.raises(ValueError, match='Another offline discovery run'):
            with offline.journal_lock(path):
                pytest.fail('A second writer obtained the journal lock')
    with offline.journal_lock(path):
        assert (path.parent / 'journal.json.lock').exists()


def test_descriptive_hn_headline_requires_manual_identity_review():
    headline = 'Put AI to work across your company'
    web = Mock()
    web.fetch.return_value = page(headline + ' is a browser-based software platform for project management and planning.')
    with pytest.raises(FetchError, match='headline'):
        offline.assess(candidate(name=headline), web)


def test_cross_host_redirect_does_not_prove_official_product_identity():
    web = Mock()
    web.fetch.return_value = {**page('ActualApp provides project management software.'), 'url': 'https://unrelated.dev/'}
    with pytest.raises(FetchError, match='Cross-host redirect'):
        offline.assess(candidate(), web)


def test_candidates_on_same_host_share_safeweb_budget_and_delay():
    first = candidate(url='https://actual.dev/a')
    second = candidate(url='https://actual.dev/b', external_id='2')
    state = {'records': [{'id': offline.candidate_key(c), 'candidate': c, 'status': 'pending'} for c in [first, second]]}
    web = Mock()
    web.fetch.return_value = page('ActualApp provides project management software for organizing work and software delivery.')
    factory = Mock(return_value=web)
    offline.verify_pending(state, {'products': []}, 10, 2, lambda _: None, factory)
    factory.assert_called_once()
    assert web.fetch.call_count == 2


def test_existing_drafts_are_reaudited_without_network_requests():
    web = Mock()
    web.fetch.return_value = page('ActualApp provides project management software for organizing work and software delivery.')
    draft = offline.assess(candidate(), web)
    draft['product']['verification_scope'] = 'capabilities'
    draft['product']['capabilities'] = [{'slug': 'projects', 'evidence_text': 'Coming soon: project management software for all your team projects.'}]
    state = {'records': [{'id': '1', 'candidate': candidate(), 'status': 'draft', 'draft': draft}]}
    assert offline.audit_saved_drafts(state) == 1
    assert state['records'][0]['status'] == 'held'
    assert 'draft' not in state['records'][0]
    assert offline.summary(state)['publication_drafts'] == 0


def test_private_root_itself_is_not_a_file_path(tmp_path, monkeypatch):
    monkeypatch.setattr(offline, 'PRIVATE_ROOT', tmp_path / '.ingestion-state')
    with pytest.raises(ValueError, match='must stay inside'):
        offline.private_path(offline.PRIVATE_ROOT)


@pytest.mark.parametrize('sentence', ['Demo data, made up in your browser', 'Not a web app', 'Account sign-in happens in your browser and tokens live in Windows Credential Manager', 'Start free', 'Satirical SaaS Pricing'])
def test_desktop_auth_demo_and_signup_are_not_web_availability(sentence):
    assert not offline.web_availability(sentence)
