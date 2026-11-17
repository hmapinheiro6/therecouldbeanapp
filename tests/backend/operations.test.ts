import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { splitSql } from "../../scripts/sql";
import { staticOperations } from "../../worker/operations-schema";
import { budgetState, READ_LIMIT, WRITE_LIMIT } from "../../worker/budget";
import { staleRuns } from "../../worker/operations";
import { blockedRoutes } from "../../worker/urgent-removal";
import { observedDatabase } from "../../worker/query-metrics";
it("keeps executable maintenance identical to the tracked migration", () => {
  expect(staticOperations).toEqual(
    splitSql(readFileSync("migrations/0013_static_operations.sql", "utf8")),
  );
});
it("fails closed for stale/missing usage and stops on either 70 percent threshold", () => {
  const now = new Date("2026-11-17T12:00:00Z"),
    usage = {
      day: "2026-11-17",
      observed_at: now.toISOString(),
      rows_read: 100,
      rows_written: 10,
    };
  expect(budgetState(usage, now).allowed).toBe(true);
  expect(budgetState({ ...usage, rows_read: READ_LIMIT }, now).allowed).toBe(
    false,
  );
  expect(
    budgetState({ ...usage, rows_written: WRITE_LIMIT }, now).allowed,
  ).toBe(false);
  expect(
    budgetState({ ...usage, observed_at: "2026-11-17T11:30:00Z" }, now).allowed,
  ).toBe(false);
  expect(budgetState(null, now).allowed).toBe(false);
  expect(budgetState({ ...usage, day: "2026-11-16" }, now).allowed).toBe(false);
});
it("distinguishes a fresh in-flight job from stale or hung jobs", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const run = {
    status: "completed",
    conclusion: "success",
    updated_at: "2026-11-17T00:00:00Z",
    created_at: "2026-11-17T00:00:00Z",
    html_url: "https://github.com/example",
  };
  expect(staleRuns([run], now)).toBe(true);
  expect(
    staleRuns(
      [{ ...run, status: "in_progress", created_at: "2026-11-17T11:45:00Z" }],
      now,
    ),
  ).toBe(false);
  expect(staleRuns([{ ...run, status: "in_progress" }], now)).toBe(true);
});
it("routes only removed product paths through the temporary blocker", () => {
  expect(blockedRoutes(["removed-app"])).toEqual([
    "/api/admin/*",
    "/api/internal/*",
    "/api/submit",
    "/apps/removed-app",
    "/apps/removed-app/",
  ]);
  expect(() => blockedRoutes(["../../bad"])).toThrow();
  expect(() => blockedRoutes(Array(46).fill("app"))).toThrow();
});
it("accounts first/all/run/batch provider rows without logging private SQL values", async () => {
  const logs = vi.spyOn(console, "log").mockImplementation(() => {});
  const result = {
    success: true,
    results: [{ value: "private@example.dev" }],
    meta: { rows_read: 3, rows_written: 2 },
  };
  const statement = {
    bind() {
      return this;
    },
    all: async () => result,
    run: async () => result,
  };
  const raw = {
    prepare: () => statement,
    batch: async () => [result],
  } as unknown as D1Database;
  const usage = { rows_read: 0, rows_written: 0, queries: 0 };
  const db = observedDatabase(raw, "test-job", usage);
  expect(
    await db
      .prepare("SELECT secret WHERE email=?")
      .bind("private@example.dev")
      .first("value"),
  ).toBe("private@example.dev");
  await db.prepare("query").all();
  await db.prepare("query").run();
  await db.batch([db.prepare("query")]);
  expect(usage).toEqual({ rows_read: 12, rows_written: 8, queries: 4 });
  expect(JSON.stringify(logs.mock.calls)).not.toContain("private@example.dev");
  logs.mockRestore();
});

it("keeps independent issue alerts working when D1 is unavailable", async () => {
  const { watchdog } = await import("../../worker/operations");
  const now = new Date("2026-11-17T12:00:00Z");
  const remote = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/runs?"))
      return Response.json({
        workflow_runs: [
          {
            status: "completed",
            conclusion: "success",
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            html_url: "https://github.com/example/run",
          },
        ],
      });
    if (url.includes("provenance.json"))
      return Response.json({
        content: btoa(JSON.stringify({ saved_at: now.toISOString() })),
      });
    if (url.includes("backup-health.json"))
      return Response.json({
        content: btoa(JSON.stringify({ last_success_at: now.toISOString() })),
      });
    if (init?.method === "POST") return Response.json({ number: 1 });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", remote);
  try {
    await watchdog(
      {
        WATCHDOG_GITHUB_TOKEN: "isolated-test-token",
        DB: {
          prepare() {
            throw new Error("D1 daily limit");
          },
        },
      } as never,
      now,
    );
    const creation = remote.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(creation).toBeDefined();
    expect(String(creation?.[1]?.body)).toContain("D1 usage cannot be read");
  } finally {
    vi.unstubAllGlobals();
  }
});
