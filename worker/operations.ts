import { observedDatabase } from "./query-metrics";
import { currentBudget, refreshBudget } from "./budget";
import type { Bindings } from "./security";
const REPO = "hmapinheiro6/therecouldbeanapp";
async function github(
  env: Bindings,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch("https://api.github.com/repos/" + REPO + path, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "tcba-cloudflare-watchdog",
      ...(env.WATCHDOG_GITHUB_TOKEN
        ? { Authorization: "Bearer " + env.WATCHDOG_GITHUB_TOKEN }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
  if (!response.ok)
    throw new Error("GitHub operation failed: " + response.status);
  return response.status === 204 ? null : response.json();
}
export async function requestStaticPublish(env: Bindings, blockedSlug = "") {
  if (blockedSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(blockedSlug))
    throw new Error("Invalid removal path");
  if (!env.WATCHDOG_GITHUB_TOKEN) return "awaiting_deployment_credential";
  try {
    await github(
      env,
      "/actions/workflows/static-publish.yml/dispatches",
      "POST",
      { ref: "main", inputs: { blocked_slug: blockedSlug } },
    );
    return "queued";
  } catch {
    console.error(JSON.stringify({ event: "static_publish_dispatch_failed" }));
    return "dispatch_failed";
  }
}
interface Run {
  status: string;
  conclusion: string | null;
  updated_at: string;
  created_at: string;
  html_url: string;
}
export function staleRuns(runs: Run[], now = Date.now(), maxAgeHours = 8) {
  const successful = runs.find((r) => r.conclusion === "success");
  const active = runs.find(
    (r) =>
      ["queued", "in_progress", "waiting", "requested", "pending"].includes(
        r.status,
      ) && now - Date.parse(r.created_at) < 3600_000,
  );
  return (
    !active &&
    (!successful ||
      now - Date.parse(successful.updated_at) > maxAgeHours * 3600_000)
  );
}
export async function watchdog(env: Bindings, now = new Date()) {
  const problems: string[] = [];
  for (const [workflow, hours] of [
    ["cloud-discovery", 8],
    ["intelligence", 4],
  ] as const) {
    const data = (await github(
      env,
      "/actions/workflows/" + workflow + ".yml/runs?branch=main&per_page=10",
    )) as { workflow_runs: Run[] };
    if (staleRuns(data.workflow_runs, now.getTime(), hours))
      problems.push(workflow + " has no recent successful job checkpoint");
  }
  // A successful collector must also have a nonexpiring durable checkpoint.
  try {
    const file = (await github(
      env,
      "/contents/provenance.json?ref=state%2Fcloud-discovery",
    )) as { content: string };
    const provenance = JSON.parse(atob(file.content.replace(/\s/g, ""))) as {
      saved_at: string;
    };
    if (now.getTime() - Date.parse(provenance.saved_at) > 8 * 3600_000)
      problems.push("Encrypted collector checkpoint is stale");
  } catch {
    problems.push("Encrypted collector checkpoint is missing or unreadable");
  }
  try {
    const file = (await github(env, "/contents/data/backup-health.json")) as {
      content: string;
    };
    const health = JSON.parse(atob(file.content.replace(/\s/g, ""))) as {
      last_success_at: string;
    };
    if (now.getTime() - Date.parse(health.last_success_at) > 36 * 3600_000)
      problems.push("Verified encrypted full database backup is stale");
  } catch {
    problems.push(
      "Verified encrypted full database backup is missing or unreadable",
    );
  }
  try {
    const budget = await currentBudget(env);
    if (!budget.allowed && budget.reason === "usage_unavailable")
      problems.push(
        "Account D1 usage telemetry is unavailable; bulk jobs are paused",
      );
  } catch {
    // An exhausted database must not suppress alerts about missed hosted jobs.
    problems.push("D1 usage cannot be read; check the account allowance");
  }
  if (!env.WATCHDOG_GITHUB_TOKEN)
    throw new Error("Independent issue alerts need WATCHDOG_GITHUB_TOKEN");
  const title = "[Watchdog] Autonomous catalog jobs need attention";
  const issues = (await github(env, "/issues?state=open&per_page=100")) as {
    number: number;
    title: string;
  }[];
  const issue = issues.find((i) => i.title === title);
  if (problems.length && !issue)
    await github(env, "/issues", "POST", {
      title,
      body:
        "Cloudflare Cron detected the following at " +
        now.toISOString() +
        ":\n\n" +
        problems.map((p) => "- " + p).join("\n") +
        "\n\nCheck the Actions logs and state/cloud-discovery checkpoint. This monitor runs in Cloudflare independently of GitHub schedules.",
    });
  if (!problems.length && issue)
    await github(env, "/issues/" + issue.number, "PATCH", {
      state: "closed",
      state_reason: "completed",
    });
  console.log(
    JSON.stringify({
      event: "independent_watchdog",
      status: problems.length ? "attention_required" : "healthy",
      problems,
    }),
  );
}
export async function operationsCron(
  _event: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext,
) {
  // Run independently: missing analytics must never suppress missed-job alerts.
  const measured = (job: string) => ({
    ...env,
    DB: observedDatabase(env.DB, job, {
      rows_read: 0,
      rows_written: 0,
      queries: 0,
    }),
  });
  ctx.waitUntil(
    Promise.allSettled([
      refreshBudget(measured("account_budget")),
      watchdog(measured("watchdog")),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === "rejected")
          console.error(
            JSON.stringify({
              event: "operations_failed",
              job: i === 0 ? "budget" : "watchdog",
              kind: r.reason instanceof Error ? r.reason.message : "unknown",
            }),
          );
      });
    }),
  );
}
