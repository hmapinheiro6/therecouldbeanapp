import { spawn, spawnSync } from "node:child_process";
const env = {
  ...process.env,
  WRANGLER_LOG_PATH: ".wrangler/logs",
  WRANGLER_SEND_METRICS: "false",
};
for (const args of [
  ["d1", "migrations", "apply", "DB", "--local"],
  ["d1", "execute", "DB", "--local", "--file=data/seeds/catalog.sql"],
]) {
  const r = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit", env });
  if (r.status) process.exit(r.status);
}
const worker = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--port",
    "8787",
    "--var",
    "SUBMISSIONS_ENABLED:false",
    "--var",
    "SITE_URL:http://127.0.0.1:8787",
    "--var",
    "ADMIN_SECRET:isolated-e2e-admin-access-key-for-local-tests-only",
    "--var",
    "INTERNAL_SECRET:isolated-e2e-signing-key-for-local-tests-only",
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    worker.kill(signal);
    process.exit();
  });
worker.on("exit", (code) => process.exit(code ?? 0));
