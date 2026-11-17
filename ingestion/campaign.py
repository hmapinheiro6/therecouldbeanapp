"""Dated publication priority; no external dependencies or credentials."""
from datetime import datetime, timezone
import json
from .extraction import ROOT


def expansion_priority(stamp=None):
    path=ROOT/'data/expansion-campaign.json'
    if not path.exists(): return None
    config=json.loads(path.read_text());moment=stamp or datetime.now(timezone.utc)
    if not config.get('enabled') or moment >= datetime.fromisoformat(config['deadline'].replace('Z','+00:00')): return None
    health=ROOT/'data/expansion-health.json'
    if health.exists() and json.loads(health.read_text()).get('status') in ('target_reached','source_exhausted','deadline_reached'): return None
    return config['deadline']
