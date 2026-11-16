import type { Product, Capability } from "../src/lib/types";
export interface ProductRow extends Omit<Product, "capabilities" | "sources"> {
  bm25: number;
}
export const PRODUCT_SELECT = `SELECT p.id,p.slug,p.name,p.canonical_url,p.normalized_domain,p.short_description,p.audience,p.first_seen_at,p.announced_at,p.last_verified_at,p.verification_scope,p.identity_evidence_url,p.identity_evidence_text,c.name category,c.slug category_slug`;
export async function hydrate(db: D1Database, rows: ProductRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);
  const caps = await db
    .prepare(
      `SELECT pc.product_id,k.slug,k.name,pc.evidence_url,pc.evidence_text,pc.verified_at FROM product_capabilities pc JOIN capabilities k ON k.id=pc.capability_id WHERE pc.confidence_class='verified' AND pc.product_id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(...ids)
    .all<Capability & { product_id: number }>();
  const grouped = new Map<number, Capability[]>();
  for (const c of caps.results) {
    const list = grouped.get(c.product_id) ?? [];
    list.push(c);
    grouped.set(c.product_id, list);
  }
  return rows.map((p) => ({ ...p, capabilities: grouped.get(p.id) ?? [] }));
}
export async function getProduct(db: D1Database, slug: string) {
  const row = await db
    .prepare(
      `${PRODUCT_SELECT},0 bm25 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.status='published'`,
    )
    .bind(slug)
    .first<ProductRow>();
  if (!row) return null;
  const [product] = await hydrate(db, [row]);
  const sources = await db
    .prepare(
      "SELECT source_name,source_url,discovered_at FROM product_sources WHERE product_id=? LIMIT 10",
    )
    .bind(row.id)
    .all<{ source_name: string; source_url: string; discovered_at: string }>();
  return { ...product, sources: sources.results };
}
// Materialization prevents the status index from driving a repeated FTS scan.
export const RETRIEVAL_SQL = `WITH candidates AS MATERIALIZED (
 SELECT rowid,rank AS bm25 FROM product_fts WHERE product_fts MATCH ?
 AND rank MATCH 'bm25(6,1,2,5,2,3)' ORDER BY rank LIMIT 80
) ${PRODUCT_SELECT},f.bm25 FROM candidates f JOIN products p ON p.id=f.rowid
 JOIN categories c ON c.id=p.category_id WHERE p.status='published' ORDER BY f.bm25`;
