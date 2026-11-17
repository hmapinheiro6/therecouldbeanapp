import { spawnSync } from "node:child_process";
const values = Object.fromEntries(
  ["CLOUDFLARE_API_TOKEN", "WATCHDOG_GITHUB_TOKEN"].map((key) => [
    key,
    process.env[key],
  ]),
);
if (Object.values(values).some((v) => !v))
  throw new Error("Missing operations credentials");
const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
  input: JSON.stringify(values),
  encoding: "utf8",
});
// Never echo child output or secret values.
if (result.status !== 0)
  throw new Error("Server operations credentials could not be installed");
console.log("Server-only operations credentials installed.");
