from unittest.mock import Mock, patch
import json
from io import BytesIO
from urllib.error import HTTPError
import pytest
from ingestion.client import InternalAPIError, InternalClient
from ingestion.workflow import execute


@pytest.fixture
def files(tmp_path, monkeypatch):
    output, summary = tmp_path / 'output', tmp_path / 'summary'
    monkeypatch.setenv('GITHUB_OUTPUT', str(output))
    monkeypatch.setenv('GITHUB_STEP_SUMMARY', str(summary))
    return output, summary


def test_ready_prepares_database_before_enabling_source_work(files):
    with patch('ingestion.workflow.InternalClient') as client:
        client.return_value.request.side_effect = [{'allowed':True}, {'status': 'ready'}]
        assert execute('prepare') == 0
        assert client.return_value.request.call_args_list[0].args == ('/api/internal/budget',)
        client.return_value.request.assert_called_with('/api/internal/maintenance', {})
    assert 'ready=true' in files[0].read_text()
    assert 'READY' in files[1].read_text()


@pytest.mark.parametrize('status,code', [(503, 'database_daily_limit'), (429, 'ingestion_daily_budget')])
def test_prepare_defers_known_limits_and_never_starts_collection(files, status, code):
    error = InternalAPIError(status, 'private diagnostic', code, '2026-11-17T00:00:00Z')
    with patch('ingestion.workflow.InternalClient') as client, patch('ingestion.run.run') as discover, patch('ingestion.backfill.run') as backfill:
        client.return_value.request.side_effect = error
        assert execute('prepare') == 0
        discover.assert_not_called()
        backfill.assert_not_called()
    assert 'ready=false' in files[0].read_text()
    assert 'outcome=deferred' in files[0].read_text()
    assert 'not a completed collection' in files[1].read_text()
    assert '2026-11-17T00:00:00Z' in files[1].read_text()


@pytest.mark.parametrize('status,code', [(401, 'unauthorized'), (403, None), (503, None), (500, 'database_daily_limit'), (401, 'database_daily_limit')])
def test_auth_unknown_unavailability_and_wrong_status_remain_failures(files, capsys, status, code):
    with patch('ingestion.workflow.InternalClient') as client:
        client.return_value.request.side_effect = InternalAPIError(status, 'DO_NOT_LOG_PRIVATE', code)
        assert execute('prepare') == 1
    assert 'outcome=failed' in files[0].read_text()
    assert 'DO_NOT_LOG_PRIVATE' not in capsys.readouterr().out


def test_failed_or_malformed_configuration_stays_failed(files):
    with patch('ingestion.workflow.InternalClient', side_effect=KeyError('private config')):
        assert execute('prepare') == 1
    with patch('ingestion.workflow.InternalClient') as client:
        client.return_value.request.return_value = {'status': 'unexpected'}
        assert execute('prepare') == 1


def test_partial_source_failure_is_not_reported_as_success(files):
    with patch('ingestion.run.run', return_value=1):
        assert execute('discover') == 1
    assert 'outcome=failed' in files[0].read_text()


@pytest.mark.parametrize('stage,target', [('discover', 'ingestion.run.run'), ('backfill', 'ingestion.backfill.run')])
def test_limit_during_an_import_is_explicitly_partial_not_complete(files, stage, target):
    with patch(target, side_effect=InternalAPIError(429, 'Budget', 'ingestion_daily_budget')):
        assert execute(stage) == 0
    assert 'outcome=deferred' in files[0].read_text()
    assert 'earlier batches may have committed' in files[1].read_text()
    assert 'outcome=completed' not in files[0].read_text()


@pytest.mark.parametrize('stage,target', [('discover', 'ingestion.run.run'), ('backfill', 'ingestion.backfill.run')])
def test_completed_import_gets_a_distinct_completed_outcome(files, stage, target):
    with patch(target, return_value=0):
        assert execute(stage) == 0
    assert 'outcome=completed' in files[0].read_text()


def test_client_preserves_typed_limit_and_reset_without_retry():
    opener = Mock()
    payload = {'error': {'code': 'database_daily_limit', 'message': 'quota', 'reset_at': '2026-11-17T00:00:00Z'}}
    opener.open.side_effect = HTTPError('https://app.dev/api/internal/maintenance', 503, 'quota', {}, BytesIO(json.dumps(payload).encode()))
    with patch('ingestion.client.urllib.request.build_opener', return_value=opener), patch('ingestion.client.time.sleep') as sleep:
        with pytest.raises(InternalAPIError) as raised:
            InternalClient(base='https://app.dev', secret='isolated-workflow-test-at-least-32-chars').request('/api/internal/maintenance', {})
        assert raised.value.code == 'database_daily_limit'
        assert raised.value.reset_at == payload['error']['reset_at']
        sleep.assert_not_called()


def test_untrusted_reset_text_cannot_inject_workflow_commands(files, capsys):
    with patch('ingestion.workflow.InternalClient') as client:
        client.return_value.request.side_effect = InternalAPIError(503, 'private', 'database_daily_limit', '\n::error::injected')
        assert execute('prepare') == 0
    assert '::error::injected' not in capsys.readouterr().out
    assert '::error::injected' not in files[1].read_text()


def test_backfill_failure_reporting_cannot_replace_the_original_quota_error():
    from ingestion.backfill import run
    candidate = {'name': 'ActualApp', 'canonical_url': 'https://actual.dev', 'source_name': 'GitHub', 'source_url': 'https://github.com/actual/app', 'external_id': '1', 'licensed_description': 'A software application.'}
    error = InternalAPIError(429, 'Budget', 'ingestion_daily_budget')
    client = Mock()
    client.request.side_effect = [None, {'known': []}, error, RuntimeError('Final status cannot be saved')]
    with patch('ingestion.backfill.InternalClient', return_value=client), patch('ingestion.backfill.SafeWeb') as web, patch('ingestion.backfill.candidates_from', return_value=[candidate]), patch('ingestion.backfill.verify_identity', return_value={'name': 'ActualApp'}):
        web.return_value.fetch.return_value = {'text': '[]'}
        with pytest.raises(InternalAPIError) as raised:
            run(1, 1)
    assert raised.value is error


@pytest.fixture(autouse=True)
def isolate_campaign_priority(monkeypatch):
    monkeypatch.setattr("ingestion.campaign.expansion_priority", lambda: None)
