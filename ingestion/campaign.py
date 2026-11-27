"""Dated publication priority; no external dependencies or credentials."""
from datetime import datetime, timezone
import json
from .extraction import ROOT


def expansion_priority(stamp=None):
    path=ROOT/'data/expansion-campaign.json'
    if not path.exists(): return None
    config=json.loads(path.read_text());moment=stamp or datetime.now(timezone.utc)
    # Recurring bulk checks share the write queue and never suspend SaaS discovery.
    if config.get('mode') == 'continuous': return None
    if not config.get('enabled') or moment >= datetime.fromisoformat(config['deadline'].replace('Z','+00:00')): return None
    # Preserve today's remaining allowance even when the campaign finishes early.
    # Regular scheduled imports resume after the dated hold, around UTC reset.
    return config['deadline']
