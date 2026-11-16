import type { z } from "zod";
import type { ingestSchema } from "./validation";

// Deliberately leave headroom in the Free account for visitors, moderation,
// nonce/session writes, and other databases. Units are conservative estimates,
// not the provider's rows_written measurement or an account-wide guarantee.
export const DAILY_INGESTION_UNITS = 20_000;
export function ingestionUnits(batch: z.infer<typeof ingestSchema>) {
  return (
    batch.products.reduce((n, p) => n + 80 + p.capabilities.length * 8, 0) +
    batch.candidates.length * 12 +
    batch.checkpoints.length * 4 +
    (batch.run ? 4 : 0)
  );
}
export async function reserveIngestion(
  db: D1Database,
  units: number,
  now = new Date(),
) {
  if (!Number.isSafeInteger(units) || units < 0)
    throw new Error("Invalid ingestion reservation.");
  if (!units) return true;
  // A single conditional UPSERT arbitrates concurrent signed jobs. Failed
  // subsequent writes retain their reservation, so failures cannot reopen it.
  const reserved = await db
    .prepare(
      `INSERT INTO ingestion_daily_budget(day,reserved_units) SELECT ?,? WHERE ?<=?
     ON CONFLICT(day) DO UPDATE SET reserved_units=reserved_units+excluded.reserved_units
     WHERE reserved_units+excluded.reserved_units<=?
     RETURNING reserved_units`,
    )
    .bind(
      now.toISOString().slice(0, 10),
      units,
      units,
      DAILY_INGESTION_UNITS,
      DAILY_INGESTION_UNITS,
    )
    .first();
  return reserved !== null;
}
