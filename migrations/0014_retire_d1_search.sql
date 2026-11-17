-- Browser search is built from the published export. No public request uses D1 search.
DROP TRIGGER IF EXISTS product_insert;
DROP TRIGGER IF EXISTS product_update;
DROP TRIGGER IF EXISTS product_delete;
DROP TRIGGER IF EXISTS capability_insert;
DROP TRIGGER IF EXISTS capability_update;
DROP TRIGGER IF EXISTS capability_delete;
DROP TRIGGER IF EXISTS category_update;
DROP TRIGGER IF EXISTS taxonomy_capability_update;
DROP TABLE IF EXISTS product_fts;
DROP VIEW IF EXISTS search_documents;
