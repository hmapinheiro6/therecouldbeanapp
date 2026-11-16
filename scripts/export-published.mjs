// Node 24. Default is an offline plan; only --remote contacts production.
import { spawnSync } from "node:child_process";
import {
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { EXPORT_QUERIES, assembleExport } from "./published-export.ts";
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const maxRows = args.includes("--max-rows")
  ? Number(args[args.indexOf("--max-rows") + 1])
  : 100_000;
if (
  !Number.isSafeInteger(maxRows) ||
  maxRows < 1 ||
  maxRows > 200_000 ||
  args.some(
    (a, i) =>
      a !== "--remote" && a !== "--max-rows" && args[i - 1] !== "--max-rows",
  )
) {
  console.error(
    "Usage: node scripts/export-published.mjs [--remote] [--max-rows 100000]",
  );
  process.exit(1);
}
if (!remote) {
  console.log(
    JSON.stringify(
      {
        mode: "offline-plan",
        queries: EXPORT_QUERIES.length,
        max_reported_rows: maxRows,
        note: "No database contacted. --remote performs four linear reads. The limit is checked after execution; it cannot cap provider billing.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const target = "data/seeds/published-snapshot.json";
const lock = target + ".export.local",
  temporary = target + ".pending.local";
let locked = false;
try {
  closeSync(openSync(lock, "wx", 0o600));
  locked = true;
  const previous = JSON.parse(readFileSync(target, "utf8"));
  const result = spawnSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      EXPORT_QUERIES.join(";\n") + ";",
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error("Published export failed; existing snapshot preserved.");
  const { products, rowsRead, claims } = assembleExport(
    JSON.parse(result.stdout),
    previous.products.length,
    maxRows,
  );
  writeFileSync(
    temporary,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        environment: "production",
        products,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  renameSync(temporary, target);
  console.log(
    JSON.stringify(
      {
        exported_products: products.length,
        verified_claims: claims,
        rows_read: rowsRead,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof SyntaxError
      ? "Invalid export JSON; snapshot preserved."
      : error.code === "EEXIST"
        ? "Another export holds the lock; snapshot preserved."
        : error.message,
  );
  process.exitCode = 1;
} finally {
  if (locked) {
    try {
      unlinkSync(temporary);
    } catch {
      /* No temporary output on early failure. */
    }
    unlinkSync(lock);
  }
}
