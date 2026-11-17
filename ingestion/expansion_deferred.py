"""Mark the dated campaign paused without researching or touching D1."""
import json
from .expansion import JOURNAL, health
from .extraction import ROOT


def defer():
    state = json.loads(JOURNAL.read_text())
    published = json.loads((ROOT / 'data/seeds/published-snapshot.json').read_text())
    # The previous campaign report can predate its last committed batch.
    # Use the authoritative public build input rather than repeating that old count.
    return health(state, 'quota_deferred', len(published['products']))


if __name__ == '__main__':
    defer()
