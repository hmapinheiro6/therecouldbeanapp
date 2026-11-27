from unittest.mock import Mock
import pytest
from ingestion.operations_check import verify

def test_checks_deployed_runtime_without_claiming_an_exhausted_budget_is_open(capsys):
    client=Mock();client.request.return_value={'status':'verified','budget':{'allowed':False,'reason':'daily_70_percent_budget'},'private_future_field':'must-not-be-printed'}
    verify(client)
    client.request.assert_called_once_with('/api/internal/operations-check',{})
    output=capsys.readouterr().out
    assert '"bulk_allowed": false' in output and 'must-not-be-printed' not in output

def test_cannot_claim_activation_with_missing_telemetry():
    client=Mock();client.request.return_value={'status':'verified','budget':{'allowed':False,'reason':'usage_unavailable'}}
    with pytest.raises(ValueError):verify(client)
