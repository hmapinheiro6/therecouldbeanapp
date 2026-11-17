INSERT OR IGNORE INTO catalog_counters(key,value) VALUES('revision',0);
CREATE TABLE IF NOT EXISTS publication_lease(id TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS catalog_revision_insert AFTER INSERT ON products BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_update AFTER UPDATE ON products BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_delete AFTER DELETE ON products BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_cap_insert AFTER INSERT ON product_capabilities BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_cap_update AFTER UPDATE ON product_capabilities BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_cap_delete AFTER DELETE ON product_capabilities BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_source_insert AFTER INSERT ON product_sources BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_source_update AFTER UPDATE ON product_sources BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
CREATE TRIGGER IF NOT EXISTS catalog_revision_source_delete AFTER DELETE ON product_sources BEGIN
 UPDATE catalog_counters SET value=value+1 WHERE key='revision'; END;
