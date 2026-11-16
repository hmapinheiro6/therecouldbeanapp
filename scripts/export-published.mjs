// Four linear reads: never run a correlated provenance scan for every product.
// Explicit allow-list: no submissions, moderation notes, rate keys, or secrets.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const sql = `SELECT p.id,p.slug,p.name,p.canonical_url,p.short_description,c.slug category_slug,p.audience,p.search_aliases,p.first_seen_at,p.announced_at,p.last_verified_at,p.verification_scope,p.identity_evidence_url,p.identity_evidence_text FROM products p JOIN categories c ON c.id=p.category_id WHERE p.status='published' ORDER BY p.name;
SELECT pc.product_id,k.slug,k.name,pc.evidence_url,pc.evidence_text,pc.verified_at FROM product_capabilities pc JOIN capabilities k ON k.id=pc.capability_id JOIN products p ON p.id=pc.product_id WHERE p.status='published' AND pc.confidence_class='verified';
SELECT s.product_id,s.source_type,s.source_name,s.source_url,s.external_id,s.discovered_at FROM product_sources s JOIN products p ON p.id=s.product_id WHERE p.status='published';
SELECT a.alias,a.canonical_url FROM product_url_aliases a JOIN products p ON p.canonical_url=a.canonical_url WHERE p.status='published';`;
const result = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", "--remote", "--command", sql, "--json"],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
if (result.error || result.status !== 0) {
  console.error("Published export failed. No private data was exported.");
  process.exit(1);
}
const [rows, claims, sources, aliases] = JSON.parse(result.stdout).map(
  (r) => r.results,
);
const group = (rows, key) => {
  const grouped = new Map();
  for (const row of rows) {
    const { [key]: value, ...fields } = row;
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(fields);
  }
  return grouped;
};
const productClaims = group(claims, "product_id"),
  productSources = group(sources, "product_id"),
  productAliases = group(aliases, "canonical_url");
const products = rows.map(({ id, ...p }) => ({
  ...p,
  capabilities: productClaims.get(id) ?? [],
  sources: productSources.get(id) ?? [],
  url_aliases: (productAliases.get(p.canonical_url) ?? []).map((a) => a.alias),
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
      verified_claims: claims.length,
      rows_read: JSON.parse(result.stdout).reduce(
        (n, r) => n + (r.meta?.rows_read ?? 0),
        0,
      ),
    },
    null,
    2,
  ),
);
