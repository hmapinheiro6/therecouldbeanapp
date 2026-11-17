// Keep these independent linear reads: never embed per-product provenance scans.
export const EXPORT_QUERIES = [
  `SELECT p.id,p.slug,p.name,p.canonical_url,p.short_description,c.slug category_slug,p.audience,p.search_aliases,p.first_seen_at,p.announced_at,p.last_verified_at,p.verification_scope,p.identity_evidence_url,p.identity_evidence_text FROM products p JOIN categories c ON c.id=p.category_id WHERE p.status='published' ORDER BY p.name`,
  `SELECT pc.product_id,k.slug,k.name,pc.evidence_url,pc.evidence_text,pc.verified_at FROM product_capabilities pc JOIN capabilities k ON k.id=pc.capability_id JOIN products p ON p.id=pc.product_id WHERE p.status='published' AND pc.confidence_class='verified'`,
  `SELECT s.product_id,s.source_type,s.source_name,s.source_url,s.external_id,s.discovered_at FROM product_sources s JOIN products p ON p.id=s.product_id WHERE p.status='published'`,
  `SELECT a.alias,a.canonical_url FROM product_url_aliases a JOIN products p ON p.canonical_url=a.canonical_url WHERE p.status='published'`,
];
type Row = Record<string, unknown>;
type Result = { success: boolean; results: Row[]; meta: { rows_read: number } };
export function assembleExport(
  value: unknown,
  previousCount: number,
  maxRows = 100_000,
  authoritativeRelease = false,
) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some(
      (r) =>
        !r?.success ||
        !Array.isArray(r.results) ||
        !Number.isSafeInteger(r.meta?.rows_read) ||
        r.meta.rows_read < 0,
    )
  )
    throw new Error("Incomplete export or missing provider read accounting.");
  const results = value as Result[];
  const rowsRead = results.reduce((n, r) => n + r.meta.rows_read, 0);
  if (rowsRead > maxRows)
    throw new Error(
      "Export exceeded the declared read budget; snapshot preserved.",
    );
  const [rows, claims, sources, aliases] = results.map((r) => r.results);
  if (
    !authoritativeRelease &&
    (!rows.length || rows.length < previousCount * 0.9)
  )
    throw new Error(
      "Empty or unexpectedly smaller export; snapshot preserved for review.",
    );
  const group = (entries: Row[], key: string) => {
    const grouped = new Map<unknown, Row[]>();
    for (const row of entries) {
      const { [key]: value, ...fields } = row;
      if (!grouped.has(value)) grouped.set(value, []);
      grouped.get(value)!.push(fields);
    }
    return grouped;
  };
  const pc = group(claims, "product_id"),
    ps = group(sources, "product_id"),
    pa = group(aliases, "canonical_url");
  const seen = new Set();
  const products = rows.map(({ id, ...p }) => {
    if (
      seen.has(p.canonical_url) ||
      !ps.has(id) ||
      typeof p.slug !== "string" ||
      typeof p.canonical_url !== "string" ||
      !/^https:\/\//.test(p.canonical_url)
    )
      throw new Error(
        "Invalid identity or missing provenance; snapshot preserved.",
      );
    seen.add(p.canonical_url);
    return {
      ...p,
      capabilities: pc.get(id) ?? [],
      sources: ps.get(id)!,
      url_aliases: (pa.get(p.canonical_url) ?? []).map((a) => a.alias),
    };
  });
  return { products, rowsRead, claims: claims.length };
}
