import { pathToFileURL } from "node:url";
import {
  budgetState,
  readAccountUsage,
  USAGE_UPSERT,
} from "../worker/budget.ts";
import { recordQueries } from "./query-usage.mjs";

// Hosted activation uses the same account metrics and monotonic upsert as Cron.
// Credentials and upstream response bodies must never enter logs or artifacts.
export async function verifyOperations(env) {
  if (!env.CLOUDFLARE_API_TOKEN || !env.WATCHDOG_GITHUB_TOKEN)
    throw new Error("Operations credentials are missing");
  for (const path of [
    "/actions/workflows/static-publish.yml",
    "/issues?state=open&per_page=1",
    "/contents/data/expansion-campaign.json",
  ]) {
    const response = await fetch(
      "https://api.github.com/repos/hmapinheiro6/therecouldbeanapp" + path,
      {
        headers: {
          Authorization: "Bearer " + env.WATCHDOG_GITHUB_TOKEN,
          Accept: "application/vnd.github+json",
          "User-Agent": "tcba-operations-activation",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        "GitHub operations access check failed: " + response.status,
      );
    await response.body?.cancel();
  }
  const usage = await readAccountUsage(env);
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/272cf24b9368ff4a4c6833562cae0f0d/d1/database/2a24c33c-ee1f-4dba-b601-39f00232e3ea/query",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: USAGE_UPSERT + " RETURNING day,rows_read,rows_written,observed_at",
        params: [
          usage.day,
          usage.rows_read,
          usage.rows_written,
          usage.observed_at,
        ],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("D1 usage initialization failed");
  const data = await response.json();
  const results = data.result;
  const stored = results?.[0]?.results?.[0];
  if (
    !data.success ||
    !Array.isArray(results) ||
    results.length !== 1 ||
    !results[0].success ||
    stored?.day !== usage.day ||
    stored.observed_at !== usage.observed_at ||
    ![stored.rows_read, stored.rows_written].every(Number.isSafeInteger) ||
    stored.rows_read < usage.rows_read ||
    stored.rows_written < usage.rows_written
  )
    throw new Error("Invalid D1 usage initialization response");
  return { budget: budgetState(stored), query_results: results };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { budget, query_results } = await verifyOperations(process.env);
    recordQueries(query_results, "operations_activation");
    console.log(
      JSON.stringify({ operations_access: "verified", account_budget: budget }),
    );
  } catch (error) {
    // Network exceptions can contain upstream details; emit only known diagnostics.
    const safe = [
      "Operations credentials are missing",
      "GitHub operations access check failed:",
      "D1 usage initialization failed",
      "Invalid D1 usage initialization response",
      "Account usage unavailable",
      "Invalid account usage metrics",
    ];
    console.error(
      safe.some((message) => error.message.startsWith(message))
        ? error.message
        : "Operations access verification failed",
    );
    process.exitCode = 1;
  }
}
