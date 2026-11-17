import { recordQueries } from "./query-usage.mjs";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import { blockedRoutes } from "../worker/urgent-removal.ts";
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
const result = spawnSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--command",
    "SELECT p.slug FROM publication_blocks b JOIN products p ON p.canonical_url=b.canonical_url WHERE p.status!='published' ORDER BY p.slug LIMIT 1000",
    "--json",
  ],
  { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
);
if (result.status !== 0) throw new Error("Cannot verify public removal state");
const query = JSON.parse(result.stdout)[0];
if (!query.success || !Number.isSafeInteger(query.meta?.rows_read))
  throw new Error("Removal query accounting missing");
recordQueries([query], "prepare_blocker");
let slugs = query.results.map((r) => r.slug);
if (slugs.length) {
  const response = await fetch(
    new URL("/catalog/products.json", config.vars.SITE_URL),
    { redirect: "error", signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error("Cannot read the current public release for removal");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 24 * 1024 * 1024)
    throw new Error("Public release exceeds byte budget");
  const current = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!Array.isArray(current.products) || current.products.length > 14000)
    throw new Error("Invalid current public release");
  const visible = new Set(current.products.map((p) => p.slug));
  slugs = slugs.filter((s) => visible.has(s));
  if (slugs.length) {
    // Replicate the current release for the short blocker deployment. The signed-off
    // authoritative DB export replaces this input before the complete build.
    writeFileSync(
      "data/seeds/published-snapshot.json",
      JSON.stringify({
        exported_at: current.exported_at,
        products: current.products,
      }),
    );
  }
}
let ready = false;
if (slugs.length) {
  try {
    config.assets.run_worker_first = blockedRoutes(slugs);
    config.vars.STATIC_BLOCKED_SLUGS = JSON.stringify(slugs);
    config.main = resolve(config.main);
    config.assets.directory = resolve(config.assets.directory);
    config.d1_databases = config.d1_databases.map((d) => ({
      ...d,
      migrations_dir: resolve(d.migrations_dir),
    }));
    mkdirSync(".ingestion-state", { recursive: true });
    writeFileSync(
      ".ingestion-state/blocker.jsonc",
      JSON.stringify(config, null, 2),
    );
    ready = true;
  } catch {
    // More removals than exact-route limits: the complete build is the safe path.
    console.log(
      JSON.stringify({
        urgent_removal: "full_rebuild_required",
        removed_paths: slugs.length,
      }),
    );
  }
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, "ready=" + ready + "\n");
console.log(
  JSON.stringify({
    urgent_removal: ready ? "prepared" : "no_temporary_routes",
    removed_paths: slugs.length,
  }),
);
