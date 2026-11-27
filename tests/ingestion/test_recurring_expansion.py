import json
from pathlib import Path
import yaml

ROOT=Path(__file__).resolve().parents[2]

def workflow(name):
    return yaml.load((ROOT/'.github/workflows'/name).read_text(),Loader=yaml.BaseLoader)

def test_growth_has_a_recurring_trigger_and_no_one_day_expiry():
    config=json.loads((ROOT/'data/expansion-campaign.json').read_text())
    assert config['mode']=='continuous' and config['deadline'] is None
    assert config['target']==10000
    value=workflow('expansion.yml')
    assert value['on']['schedule']==[{'cron':'37 */2 * * *'}]
    assert value['jobs']['expand']['needs']=='allowance'

def test_each_scheduled_collector_refreshes_usage_without_requiring_a_cron_tick():
    for name,job in [('expansion.yml','expand'),('backfill.yml','backfill'),('discovery.yml','discover'),('intelligence.yml','observe'),('previews.yml','enrich'),('cloud-discovery.yml','collect')]:
        value=workflow(name)['jobs']
        assert value['allowance']['uses']=='./.github/workflows/refresh-usage.yml'
        assert value[job]['needs']=='allowance'
    cloud=workflow('cloud-discovery.yml')['jobs']['collect']
    assert 'always()' in cloud['if']  # Preserve encrypted source progress during database outages.
    shared=workflow('refresh-usage.yml')
    assert set(shared['on']['workflow_call']['secrets'])=={'CLOUDFLARE_API_TOKEN','WATCHDOG_GITHUB_TOKEN'}
