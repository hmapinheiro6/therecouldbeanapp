import type { Bindings } from "./security";
export const READ_LIMIT = 3_500_000,
  WRITE_LIMIT = 70_000;
export interface Usage {
  day: string;
  rows_read: number;
  rows_written: number;
  observed_at: string;
}
export const USAGE_UPSERT = `INSERT INTO d1_usage_observations(day,rows_read,rows_written,observed_at) VALUES(?,?,?,?)
    ON CONFLICT(day) DO UPDATE SET rows_read=MAX(rows_read,excluded.rows_read),rows_written=MAX(rows_written,excluded.rows_written),observed_at=excluded.observed_at`;
export function budgetState(usage: Usage | null, now = new Date()) {
  const fresh =
    usage?.day === now.toISOString().slice(0, 10) &&
    Date.parse(usage.observed_at) <= now.getTime() + 60_000 &&
    now.getTime() - Date.parse(usage.observed_at) < 20 * 60_000;
  const exceeded =
    !!usage &&
    usage.day === now.toISOString().slice(0, 10) &&
    (usage.rows_read >= READ_LIMIT || usage.rows_written >= WRITE_LIMIT);
  return {
    allowed: !!fresh && !exceeded,
    reason: exceeded
      ? "daily_70_percent_budget"
      : fresh
        ? "within_budget"
        : "usage_unavailable",
    usage,
    limits: { rows_read: READ_LIMIT, rows_written: WRITE_LIMIT },
    reset_at: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    ).toISOString(),
  };
}
export async function currentBudget(env: Bindings) {
  const day = new Date().toISOString().slice(0, 10);
  // A confirmed limit crossing remains closed for the UTC day even if analytics is delayed.
  const floor = env.D1_BUDGET_BLOCKED_DAY === day;
  if (floor)
    return {
      ...budgetState(null),
      reason: "daily_70_percent_budget",
      confirmed_limit_crossed: true,
    };
  const usage = await env.DB.prepare(
    "SELECT day,rows_read,rows_written,observed_at FROM d1_usage_observations WHERE day=?",
  )
    .bind(day)
    .first<Usage>();
  return budgetState(usage);
}
export async function readAccountUsage(
  env: Bindings,
  now = new Date(),
): Promise<Usage> {
  if (!env.CLOUDFLARE_API_TOKEN)
    throw new Error("Missing account analytics credential");
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query($accountTag: string!, $day: Date!) {viewer {accounts(filter:{accountTag:$accountTag}) {d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:$day,date_leq:$day}) {sum {rowsRead rowsWritten}}}}}`,
      variables: {
        accountTag: "272cf24b9368ff4a4c6833562cae0f0d",
        day: now.toISOString().slice(0, 10),
      },
    }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Account usage unavailable");
  const data = (await response.json()) as {
    errors?: unknown;
    data?: {
      viewer: {
        accounts: {
          d1AnalyticsAdaptiveGroups: {
            sum: { rowsRead: number; rowsWritten: number };
          }[];
        }[];
      };
    };
  };
  const rows = data.data?.viewer.accounts[0]?.d1AnalyticsAdaptiveGroups;
  if (
    data.errors ||
    !rows ||
    rows.some(
      (r) =>
        ![r.sum.rowsRead, r.sum.rowsWritten].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ),
    )
  )
    throw new Error("Invalid account usage metrics");
  return {
    day: now.toISOString().slice(0, 10),
    rows_read: rows.reduce((n, r) => n + r.sum.rowsRead, 0),
    rows_written: rows.reduce((n, r) => n + r.sum.rowsWritten, 0),
    observed_at: now.toISOString(),
  };
}
export async function refreshBudget(env: Bindings) {
  const usage = await readAccountUsage(env);
  await env.DB.prepare(USAGE_UPSERT)
    .bind(usage.day, usage.rows_read, usage.rows_written, usage.observed_at)
    .run();
  console.log(
    JSON.stringify({ event: "account_d1_budget", ...budgetState(usage) }),
  );
}
