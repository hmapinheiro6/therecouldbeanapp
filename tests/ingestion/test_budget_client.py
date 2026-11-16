import json
from io import BytesIO
from unittest.mock import Mock, patch
from urllib.error import HTTPError
import pytest
from ingestion.client import InternalClient, InternalAPIError

def test_project_budget_does_not_trigger_retry_storm():
    opener = Mock()
    opener.open.side_effect = HTTPError('https://app.dev/api/internal/ingest', 429, 'Budget', {}, BytesIO(json.dumps({'error': {'code': 'ingestion_daily_budget', 'message': 'Resume after 00:00 UTC'}}).encode()))
    with patch('ingestion.client.urllib.request.build_opener', return_value=opener), patch('ingestion.client.time.sleep') as sleep:
        with pytest.raises(InternalAPIError, match='00:00 UTC'):
            InternalClient(base='https://app.dev', secret='isolated-budget-test-at-least-32-chars').request('/api/internal/ingest', {})
        assert opener.open.call_count == 1
        sleep.assert_not_called()
