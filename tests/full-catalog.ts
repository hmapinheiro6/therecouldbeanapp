import { installLegacySearch } from "./db";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Exercise the real export through the documented portable restore path. Nothing
// here contacts Cloudflare or inserts synthetic products into the catalog.
export function fullCatalogDatabase() {
  const temporary = mkdtempSync(join(tmpdir(), "tcba-full-search-"));
  const output = join(temporary, "restore.sql");
  const python = existsSync(".venv/bin/python")
    ? ".venv/bin/python"
    : "python3";
  const restored = spawnSync(
    python,
    [
      "scripts/restore-snapshot.py",
      "data/seeds/published-snapshot.json",
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );
  if (restored.status !== 0) {
    rmSync(temporary, { recursive: true, force: true });
    throw new Error(`Public snapshot restore failed: ${restored.stderr}`);
  }
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync("migrations").sort())
      db.exec(readFileSync(join("migrations", file), "utf8"));
    db.exec(readFileSync(output, "utf8"));
    installLegacySearch(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
