// Kept identical to migrations/0013_static_operations.sql; validated in CI.
export const staticOperations = [
  "CREATE TABLE IF NOT EXISTS catalog_counters(key TEXT PRIMARY KEY,value INTEGER NOT NULL);",
  "INSERT OR IGNORE INTO catalog_counters(key,value) SELECT 'published',COUNT(*) FROM products WHERE status='published';",
  "CREATE TRIGGER IF NOT EXISTS catalog_count_insert AFTER INSERT ON products WHEN new.status='published' BEGIN\n UPDATE catalog_counters SET value=value+1 WHERE key='published'; END;",
  "CREATE TRIGGER IF NOT EXISTS catalog_count_delete AFTER DELETE ON products WHEN old.status='published' BEGIN\n UPDATE catalog_counters SET value=value-1 WHERE key='published'; END;",
  "CREATE TRIGGER IF NOT EXISTS catalog_count_update AFTER UPDATE OF status ON products WHEN old.status!=new.status BEGIN\n UPDATE catalog_counters SET value=value+(new.status='published')-(old.status='published') WHERE key='published'; END;",
  "CREATE TABLE IF NOT EXISTS d1_usage_observations(day TEXT PRIMARY KEY,rows_read INTEGER NOT NULL,rows_written INTEGER NOT NULL,observed_at TEXT NOT NULL);",
  "CREATE INDEX IF NOT EXISTS ingestion_started ON ingestion_runs(started_at DESC);",
  "DROP TRIGGER IF EXISTS product_update;",
  "CREATE TRIGGER product_update AFTER UPDATE OF name,short_description,category_id,audience,search_aliases,status ON products BEGIN\n DELETE FROM product_fts WHERE rowid=old.id;\n INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id=new.id;\nEND;",
];
