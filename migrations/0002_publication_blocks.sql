-- Keep explicit removals from being silently reversed by later discovery.
CREATE TABLE publication_blocks(canonical_url TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at TEXT NOT NULL);
