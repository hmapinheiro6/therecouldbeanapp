import type { z } from "zod";
import type { ingestSchema } from "./validation";
export const EXPANSION_DAY = "2026-11-17";
export const EXPANSION_DEADLINE = "2026-11-17T23:50:00Z";
export const EXPANSION_CAMPAIGN = "catalog-10k";
export const EXPANSION_UNITS = 50_000;
export const EXPANSION_TARGET = 10_000;
export const expansionStatements = [
  "CREATE TABLE IF NOT EXISTS expansion_daily_budget(day TEXT PRIMARY KEY,reserved_units INTEGER NOT NULL CHECK(reserved_units>=0),rows_written INTEGER NOT NULL DEFAULT 0,rows_read INTEGER NOT NULL DEFAULT 0)",
  "DROP INDEX IF EXISTS products_domain",
];
function campaignAllowed(campaign: string | undefined, moment: Date) {
  return (
    campaign === EXPANSION_CAMPAIGN ||
    (campaign === EXPANSION_DAY &&
      moment.toISOString().slice(0, 10) === EXPANSION_DAY &&
      moment.toISOString() < EXPANSION_DEADLINE)
  );
}
export function expansionBatch(
  b: z.infer<typeof ingestSchema>,
  moment = new Date(),
) {
  if (
    !campaignAllowed(b.expansion, moment) ||
    !b.products.length ||
    b.candidates.length ||
    b.run ||
    b.checkpoints.length
  )
    return false;
  return b.products.every(
    (p) =>
      p.verification_scope === "identity" &&
      !p.capabilities.length &&
      !p.editorial_reviewed &&
      !p.previous_canonical_url &&
      !p.submission_id &&
      p.source.source_type === "feed" &&
      ((p.source.source_name === "WinGet manifests (MIT)" &&
        p.source.source_url.startsWith(
          "https://github.com/microsoft/winget-pkgs/blob/master/manifests/",
        )) ||
        (p.source.source_name === "Scoop manifests (Unlicense)" &&
          /^https:\/\/github\.com\/ScoopInstaller\/(Main|Extras)\/blob\/master\/bucket\//.test(
            p.source.source_url,
          )) ||
        (/^Flathub AppStream \((CC0-1.0|0BSD|Unlicense)\)$/.test(
          p.source.source_name,
        ) &&
          p.source.source_url.startsWith("https://flathub.org/apps/"))),
  );
}
export async function reserveExpansion(
  db: D1Database,
  count: number,
  moment = new Date(),
  campaign: string = EXPANSION_DAY,
) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 20 ||
    !campaignAllowed(campaign, moment)
  )
    return false;
  // Seventeen estimated row writes per new product, including amortized request
  // bookkeeping. Reservations survive failures and never reopen spent allowance.
  const units = count * 17;
  const row = await db
    .prepare(
      `INSERT INTO expansion_daily_budget(day,reserved_units) SELECT ?,? WHERE ?<=?
    ON CONFLICT(day) DO UPDATE SET reserved_units=reserved_units+excluded.reserved_units
    WHERE reserved_units+excluded.reserved_units<=? RETURNING reserved_units`,
    )
    .bind(
      moment.toISOString().slice(0, 10),
      units,
      units,
      EXPANSION_UNITS,
      EXPANSION_UNITS,
    )
    .first();
  return row !== null;
}
