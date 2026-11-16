ALTER TABLE products ADD COLUMN verification_scope TEXT NOT NULL DEFAULT 'capabilities' CHECK(verification_scope IN ('identity','capabilities'));
ALTER TABLE products ADD COLUMN identity_evidence_url TEXT;
ALTER TABLE products ADD COLUMN identity_evidence_text TEXT;
ALTER TABLE ingestion_candidates ADD COLUMN review_draft_json TEXT;
CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,secret_version TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE admin_login_limits(id TEXT PRIMARY KEY,window INTEGER NOT NULL,attempts INTEGER NOT NULL);
CREATE TABLE review_audit(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX candidate_queue ON ingestion_candidates(status,created_at);
