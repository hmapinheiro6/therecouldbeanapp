import base64
from datetime import datetime,timedelta,timezone
import json
from unittest.mock import Mock
from urllib.error import HTTPError
import pytest
from ingestion.cloud_health import check,WORKFLOW,HEALTH_FILE
CLOCK=datetime(2026,11,16,15,tzinfo=timezone.utc)

def run(status='completed',conclusion='success',hours=1):
    return {'status':status,'conclusion':conclusion,'updated_at':(CLOCK-timedelta(hours=hours)).isoformat(),'html_url':'https://github.com/hmapinheiro6/therecouldbeanapp/actions/runs/123'}

def metadata(age=1,outcome="healthy"):
    content=json.dumps({'checked_at':(CLOCK-timedelta(days=age)).isoformat(),'outcome':outcome}).encode()
    return {'sha':'old-sha','content':base64.b64encode(content).decode()}

def test_recent_durable_cloud_run_needs_no_recovery_or_heartbeat_commit():
    github=Mock();github.api.side_effect=[{'workflow_runs':[run()]},metadata()]
    github.artifacts.return_value=[{'created_at':run()['updated_at']}]
    assert check(github,CLOCK)['outcome']=='healthy'
    assert github.api.call_count==2

def test_missing_runs_are_recovered_by_hosted_watchdog_without_local_input():
    github=Mock();github.api.side_effect=[{'workflow_runs':[]},None,metadata(outcome='recovery_dispatched')]
    assert check(github,CLOCK)['outcome']=='recovery_dispatched'
    github.api.assert_any_call(WORKFLOW+'/dispatches','POST',{'ref':'main'})

def test_active_run_is_never_dispatched_twice():
    github=Mock();github.api.side_effect=[{'workflow_runs':[run('in_progress',None)]},metadata(outcome='in_progress')]
    assert check(github,CLOCK)['outcome']=='in_progress'
    assert github.api.call_count==2

def test_cloud_success_without_durable_state_is_not_reported_healthy():
    github=Mock();github.api.return_value={'workflow_runs':[run()]};github.artifacts.return_value=[]
    with pytest.raises(ValueError,match='checkpoint'):check(github,CLOCK)

def test_weekly_heartbeat_writes_only_public_operational_metadata():
    github=Mock();github.api.side_effect=[{'workflow_runs':[run()]},metadata(age=8),None]
    github.artifacts.return_value=[{'created_at':run()['updated_at']}]
    assert check(github,CLOCK)['outcome']=='healthy'
    path,method,body=github.api.call_args.args
    assert path==HEALTH_FILE;assert method=='PUT';assert body['sha']=='old-sha'
    public=json.loads(base64.b64decode(body['content']))
    assert set(public)=={'checked_at','outcome','latest_success_at','latest_success_url'}

def test_first_heartbeat_can_create_the_fixed_health_file():
    github=Mock();github.api.side_effect=[{'workflow_runs':[run()]},HTTPError('https://api.github.com',404,'Missing',{},None),None]
    github.artifacts.return_value=[{'created_at':run()['updated_at']}]
    assert check(github,CLOCK)['outcome']=='healthy'
    assert 'sha' not in github.api.call_args.args[2]
