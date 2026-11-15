-- Replace a concatenated resource-link fragment with the actual official feature claims.
-- Source independently checked: https://otter.ai/meeting-notes (15 November 2026).
UPDATE product_capabilities SET evidence_url='https://otter.ai/meeting-notes',
 evidence_text=CASE capability_id
  WHEN (SELECT id FROM capabilities WHERE slug='meetings') THEN 'Record and transcribe your meetings in real time.'
  WHEN (SELECT id FROM capabilities WHERE slug='action-items') THEN 'It can even assigns action items.' END,
 verified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
WHERE product_id IN (SELECT id FROM products WHERE slug='otter')
 AND capability_id IN (SELECT id FROM capabilities WHERE slug IN ('meetings','action-items'));
UPDATE products SET last_verified_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE slug='otter';
