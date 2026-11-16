// Explicit allow-list: never export submissions, moderation notes, rate keys, or secrets.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const sql = `SELECT p.slug,p.name,p.canonical_url,p.short_description,c.slug category_slug,p.audience,p.first_seen_at,p.announced_at,p.last_verified_at,p.verification_scope,p.identity_evidence_url,p.identity_evidence_text,
 (SELECT json_group_array(json_object('slug',k.slug,'name',k.name,'evidence_url',pc.evidence_url,'evidence_text',pc.evidence_text,'verified_at',pc.verified_at)) FROM product_capabilities pc JOIN capabilities k ON k.id=pc.capability_id WHERE pc.product_id=p.id AND pc.confidence_class='verified') capabilities,
 (SELECT json_group_array(json_object('source_type',s.source_type,'source_name',s.source_name,'source_url',s.source_url,'external_id',s.external_id,'discovered_at',s.discovered_at)) FROM product_sources s WHERE s.product_id=p.id) sources
 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.status='published' ORDER BY p.name`;
const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", "--remote", "--command", sql, "--json"],
  { encoding: "utf8" },
);
if (result.status) {
  console.error("Published export failed. No private data was exported.");
  process.exit(1);
}
const rows = JSON.parse(result.stdout)[0].results;
const products = rows.map((p) => ({
  ...p,
  capabilities: JSON.parse(p.capabilities),
  sources: JSON.parse(p.sources),
}));
writeFileSync(
  "data/seeds/published-snapshot.json",
  JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      environment: "production",
      products,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      exported_products: products.length,
      verified_claims: products.reduce(
        (sum, p) => sum + p.capabilities.length,
        0,
      ),
      discovered_products: products
        .filter((p) =>
          p.sources.some((s) =>
            ["hackernews", "github"].includes(s.source_type),
          ),
        )
        .map((p) => ({ name: p.name, slug: p.slug })),
    },
    null,
    2,
  ),
);
