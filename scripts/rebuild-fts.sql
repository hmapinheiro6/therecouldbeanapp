-- Compatibility command: triggers maintain FTS incrementally. No catalog rewrite.
INSERT INTO product_fts(product_fts) VALUES('integrity-check');
