import { appendFileSync } from "node:fs";
const mode = process.argv[2],
  missing = [];
if (!process.env.CLOUDFLARE_API_TOKEN)
  missing.push("GitHub Actions secret CLOUDFLARE_API_TOKEN");
if (mode === "deployment" && !process.env.WATCHDOG_GITHUB_TOKEN)
  missing.push("GitHub Actions secret WATCHDOG_GITHUB_TOKEN");
if (!process.env.INTERNAL_SECRET)
  missing.push("GitHub Actions secret INTERNAL_SECRET");
if (mode === "backup" && !missing.length) {
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/272cf24b9368ff4a4c6833562cae0f0d/r2/buckets",
    {
      headers: { Authorization: "Bearer " + process.env.CLOUDFLARE_API_TOKEN },
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = await response.json();
  if (result.errors?.some((e) => e.code === 10042))
    missing.push("Enable R2 in the Cloudflare account");
  else if (!response.ok || !result.success)
    throw new Error(
      "The configured Cloudflare credential cannot access private R2 storage",
    );
}
const ready = !missing.length;
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, "ready=" + ready + "\n");
if (!ready) {
  const message =
    "Setup required; no " + mode + " was performed: " + missing.join("; ");
  console.log("::notice title=Cloud operations setup required::" + message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "### Setup required\n\n" + message + "\n",
    );
} else console.log("Required " + mode + " access is configured.");
