-- Avoid one full provenance scan per product; keep pagination bounded as the catalog grows.
CREATE INDEX IF NOT EXISTS product_sources_product ON product_sources(product_id);
CREATE INDEX IF NOT EXISTS product_aliases_canonical ON product_url_aliases(canonical_url);
CREATE INDEX IF NOT EXISTS published_name ON products(status,name,id);
CREATE INDEX IF NOT EXISTS published_recent ON products(status,first_seen_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS candidate_canonical ON ingestion_candidates(canonical_url,status,next_retry_at);
