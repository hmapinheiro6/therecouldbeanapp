import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { ProductRow } from "../worker/catalog";
import type { Capability } from "../src/lib/types";
import { parseQuery } from "../src/lib/search/query";
import { rank } from "../src/lib/search/rank";
import { RETRIEVAL_SQL } from "../worker/catalog";
export function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort())
    db.exec(readFileSync("migrations/" + file, "utf8"));
  db.exec(readFileSync("data/seeds/catalog.sql", "utf8"));
  return db;
}
export function search(db: DatabaseSync, q: string) {
  const intent = parseQuery(q);
  if (!intent.fts) return [];
  const rows = db
    .prepare(RETRIEVAL_SQL)
    .all(intent.fts) as unknown as ProductRow[];
  return rank(
    rows.map((p) => ({
      ...p,
      capabilities: db
        .prepare(
          `SELECT k.slug,k.name,pc.evidence_url,pc.evidence_text,pc.verified_at FROM product_capabilities pc JOIN capabilities k ON k.id=pc.capability_id WHERE pc.product_id=? AND pc.confidence_class='verified'`,
        )
        .all(p.id) as unknown as Capability[],
    })),
    intent,
  );
}
