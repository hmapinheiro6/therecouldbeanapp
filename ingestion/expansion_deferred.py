"""Mark the dated campaign paused without researching or touching D1."""
import json
from .expansion import JOURNAL,HEALTH,health
if __name__=='__main__':
    state=json.loads(JOURNAL.read_text())
    previous=json.loads(HEALTH.read_text()) if HEALTH.exists() else {}
    health(state,'quota_deferred',previous.get('published_products'))
