PRAGMA foreign_keys = ON;
CREATE TABLE categories(id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
CREATE TABLE capabilities(id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
CREATE TABLE products(
 id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL,canonical_url TEXT NOT NULL UNIQUE,
 normalized_domain TEXT NOT NULL,short_description TEXT NOT NULL CHECK(length(short_description) BETWEEN 20 AND 600),
 category_id INTEGER NOT NULL REFERENCES categories(id),audience TEXT NOT NULL DEFAULT '',search_aliases TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending_verification' CHECK(status IN ('discovered','pending_verification','verified','published','rejected','needs_review')),
 first_seen_at TEXT NOT NULL,announced_at TEXT,last_verified_at TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(status!='published' OR last_verified_at IS NOT NULL)
);
CREATE INDEX products_domain ON products(normalized_domain);
CREATE INDEX products_status_category ON products(status,category_id,id);
CREATE TABLE product_capabilities(
 product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,capability_id INTEGER NOT NULL REFERENCES capabilities(id),
 evidence_url TEXT NOT NULL,evidence_text TEXT NOT NULL CHECK(length(evidence_text) BETWEEN 8 AND 600),
 confidence_class TEXT NOT NULL CHECK(confidence_class IN ('verified','inferred')),verified_at TEXT NOT NULL,
 PRIMARY KEY(product_id,capability_id)
);
CREATE INDEX capabilities_product ON product_capabilities(capability_id,product_id);
CREATE TABLE product_sources(
 id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,source_type TEXT NOT NULL,
 source_name TEXT NOT NULL,source_url TEXT NOT NULL,external_id TEXT NOT NULL,discovered_at TEXT NOT NULL,
 UNIQUE(source_type,external_id,product_id)
);
CREATE TABLE submissions(
 id TEXT PRIMARY KEY,product_name TEXT NOT NULL,submitted_url TEXT NOT NULL,description TEXT NOT NULL,category_hint TEXT,contact_email TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','published','needs_review')),
 moderation_reason TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),reviewed_at TEXT
);
CREATE UNIQUE INDEX submission_active_url ON submissions(submitted_url) WHERE status IN ('pending','approved','needs_review');
CREATE INDEX submission_queue ON submissions(status,created_at);
CREATE TABLE ingestion_runs(
 id TEXT PRIMARY KEY,source_name TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT,status TEXT NOT NULL CHECK(status IN ('running','success','failed','partial')),
 candidates_found INTEGER NOT NULL DEFAULT 0,records_accepted INTEGER NOT NULL DEFAULT 0,records_rejected INTEGER NOT NULL DEFAULT 0,records_pending INTEGER NOT NULL DEFAULT 0,error_summary TEXT
);
CREATE INDEX ingestion_health ON ingestion_runs(completed_at DESC);
CREATE TABLE ingestion_checkpoints(source_name TEXT PRIMARY KEY,cursor_value TEXT NOT NULL,last_successful_run_at TEXT NOT NULL);
CREATE TABLE ingestion_candidates(
 id TEXT PRIMARY KEY,source_name TEXT NOT NULL,source_url TEXT NOT NULL,external_id TEXT NOT NULL,name TEXT NOT NULL,canonical_url TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('discovered','pending_verification','verified','published','rejected','needs_review')),
 reason TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_retry_at TEXT,submission_id TEXT REFERENCES submissions(id),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(source_name,external_id)
);
CREATE INDEX candidate_retry ON ingestion_candidates(status,next_retry_at);
CREATE TABLE submission_rate_limits(hashed_identifier TEXT NOT NULL,date_bucket TEXT NOT NULL,attempts INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(hashed_identifier,date_bucket));
CREATE TABLE request_nonces(nonce TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE INDEX nonce_expiry ON request_nonces(expires_at);
CREATE TABLE aggregate_events(day TEXT NOT NULL,event TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,event));
CREATE VIEW search_documents AS
 SELECT p.id,p.name,p.short_description description,c.name category,p.audience,p.search_aliases aliases,
 COALESCE((SELECT group_concat(k.name,' ') FROM product_capabilities pc JOIN capabilities k ON k.id=pc.capability_id WHERE pc.product_id=p.id AND pc.confidence_class='verified'),'') capabilities
 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.status='published';
CREATE VIRTUAL TABLE product_fts USING fts5(name,description,category,capabilities,audience,aliases,tokenize='porter unicode61 remove_diacritics 2');
CREATE TRIGGER product_insert AFTER INSERT ON products BEGIN
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id=new.id;
END;
CREATE TRIGGER product_update AFTER UPDATE ON products BEGIN
 DELETE FROM product_fts WHERE rowid=old.id;
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id=new.id;
END;
CREATE TRIGGER product_delete AFTER DELETE ON products BEGIN DELETE FROM product_fts WHERE rowid=old.id; END;
CREATE TRIGGER capability_insert AFTER INSERT ON product_capabilities BEGIN
 DELETE FROM product_fts WHERE rowid=new.product_id;
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id=new.product_id;
END;
CREATE TRIGGER capability_update AFTER UPDATE ON product_capabilities BEGIN
 DELETE FROM product_fts WHERE rowid=old.product_id OR rowid=new.product_id;
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id IN (old.product_id,new.product_id);
END;
CREATE TRIGGER capability_delete AFTER DELETE ON product_capabilities BEGIN
 DELETE FROM product_fts WHERE rowid=old.product_id;
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id=old.product_id;
END;
CREATE TRIGGER category_update AFTER UPDATE ON categories BEGIN
 DELETE FROM product_fts WHERE rowid IN (SELECT id FROM products WHERE category_id=new.id);
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id IN (SELECT id FROM products WHERE category_id=new.id);
END;
CREATE TRIGGER taxonomy_capability_update AFTER UPDATE ON capabilities BEGIN
 DELETE FROM product_fts WHERE rowid IN (SELECT product_id FROM product_capabilities WHERE capability_id=new.id);
 INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases) SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents WHERE id IN (SELECT product_id FROM product_capabilities WHERE capability_id=new.id);
END;
