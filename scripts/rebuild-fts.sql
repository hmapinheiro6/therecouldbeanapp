DELETE FROM product_fts;
INSERT INTO product_fts(rowid,name,description,category,capabilities,audience,aliases)
SELECT id,name,description,category,capabilities,audience,aliases FROM search_documents;
INSERT INTO product_fts(product_fts) VALUES('integrity-check');
