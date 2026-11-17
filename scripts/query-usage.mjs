import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
export function recordQueries(results, job) {
  for (const [i, result] of results.entries()) {
    if (
      !Number.isSafeInteger(result.meta?.rows_read) ||
      !Number.isSafeInteger(result.meta?.rows_written)
    )
      throw new Error("Provider row accounting missing");
    const value = {
      rows_read: result.meta.rows_read,
      rows_written: result.meta.rows_written,
    };
    console.log(
      JSON.stringify({ event: "d1_query", job, query: i + 1, ...value }),
    );
    if (process.env.GITHUB_ACTIONS === "true") {
      const run = process.env.GITHUB_RUN_ID;
      if (!/^\d+$/.test(run ?? ""))
        throw new Error("Invalid hosted run identity");
      mkdirSync(".ingestion-state/query-usage", {
        recursive: true,
        mode: 0o700,
      });
      appendFileSync(
        ".ingestion-state/query-usage/run-" + run + ".jsonl",
        JSON.stringify(value) + "\n",
        { mode: 0o600 },
      );
    }
  }
  const budget = JSON.parse(readFileSync("data/job-budgets.json", "utf8"));
  const limit = budget[process.env.GITHUB_WORKFLOW] ?? budget.default;
  if (results.reduce((n, r) => n + r.meta.rows_read, 0) > limit)
    throw new Error("Query set exceeded its job rows-read budget");
}
