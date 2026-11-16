"""Local SQLite VM work regression check; never contacts D1 or measures billing rows."""
import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingestion.seed import emit


def benchmark():
    snapshot = json.loads(Path('data/seeds/published-snapshot.json').read_text())
    products = snapshot['products']
    normalized = [{**p, 'source': p.get('source') or p['sources'][0]} for p in products]
    queries = json.loads(subprocess.run(['node', '--input-type=module', '-e', "import {EXPORT_QUERIES} from './scripts/published-export.ts'; console.log(JSON.stringify(EXPORT_QUERIES));"], check=True, capture_output=True, text=True).stdout)
    database = sqlite3.connect(':memory:')
    for migration in sorted(Path('migrations').glob('*.sql')):
        database.executescript(migration.read_text())
    with tempfile.TemporaryDirectory(prefix='tcba-query-cost-') as directory:
        sql = Path(directory) / 'public.sql'
        emit(normalized, str(sql))
        database.executescript(sql.read_text())
    metrics = []
    for label, query in zip(('products', 'claims', 'sources', 'aliases'), queries):
        steps = 0
        def tick():
            nonlocal steps
            steps += 1000
            return 0
        plan = [row[3] for row in database.execute('EXPLAIN QUERY PLAN ' + query)]
        if any('CORRELATED' in detail for detail in plan):
            raise RuntimeError('Correlated export plan rejected')
        database.set_progress_handler(tick, 1000)
        rows = database.execute(query).fetchall()
        database.set_progress_handler(None, 0)
        metrics.append({'query': label, 'returned_rows': len(rows), 'vm_instructions_approx': steps, 'plan': plan})
    database.close()
    total = sum(row['vm_instructions_approx'] for row in metrics)
    maximum = max(200_000, len(products) * 200)
    result = {'snapshot_exported_at': snapshot['exported_at'], 'products': len(products), 'sqlite_version': sqlite3.sqlite_version, 'measurement': 'Local SQLite VM instructions rounded down per query to 1000; not provider billing rows', 'queries': metrics, 'total_vm_instructions_approx': total, 'maximum_vm_instructions': maximum, 'passed': total <= maximum}
    if not result['passed']:
        raise RuntimeError('Public export exceeded local query work threshold: ' + str(total))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output')
    args = parser.parse_args()
    report = benchmark()
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
