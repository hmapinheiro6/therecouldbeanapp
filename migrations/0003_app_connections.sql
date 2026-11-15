-- App connections are evidence of integration support, not of multi-step workflow automation.
INSERT OR IGNORE INTO capabilities(slug,name,description) VALUES('app-connections','App connections','Connects to external applications through a documented integration interface.');
UPDATE product_capabilities SET capability_id=(SELECT id FROM capabilities WHERE slug='app-connections')
WHERE capability_id=(SELECT id FROM capabilities WHERE slug='automation')
 AND evidence_text='Connect apps through MCP'
 AND product_id IN (SELECT id FROM products WHERE canonical_url='https://pizza.hertzbeat.com');
UPDATE products SET short_description='An open-source desktop and command-line assistant that connects to applications through MCP.',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE canonical_url='https://pizza.hertzbeat.com';
