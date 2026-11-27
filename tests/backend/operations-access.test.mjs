import { afterEach, expect, it, vi } from "vitest";
import { verifyOperations } from "../../scripts/verify-operations.mjs";
import { READ_LIMIT } from "../../worker/budget";
afterEach(() => vi.unstubAllGlobals());
const env = {
  CLOUDFLARE_API_TOKEN: "cloud-test-only",
  WATCHDOG_GITHUB_TOKEN: "github-test-only",
};
function remote({ denied = false, floor = 0, analyticsDenied = false } = {}) {
  const usage = {
    day: new Date().toISOString().slice(0, 10),
    rows_read: 100,
    rows_written: 10,
    observed_at: "",
  };
  return vi.fn(async (input, init) => {
    const url = String(input);
    if (url.includes("api.github.com"))
      return Response.json({}, { status: denied ? 403 : 200 });
    if (url.endsWith("/graphql"))
      return analyticsDenied
        ? Response.json({}, { status: 403 })
        : Response.json({
            data: {
              viewer: {
                accounts: [
                  {
                    d1AnalyticsAdaptiveGroups: [
                      { sum: { rowsRead: 100, rowsWritten: 10 } },
                    ],
                  },
                ],
              },
            },
          });
    const body = JSON.parse(init.body);
    usage.observed_at = body.params[3];
    usage.rows_read = Math.max(100, floor);
    return Response.json({
      success: true,
      result: [
        {
          success: true,
          results: [usage],
          meta: { rows_read: 1, rows_written: 1 },
        },
      ],
    });
  });
}
it("activates fresh account metrics with bound parameters without exposing tokens", async () => {
  const network = remote();
  vi.stubGlobal("fetch", network);
  const result = await verifyOperations(env);
  expect(result.budget.allowed).toBe(true);
  expect(JSON.stringify(result)).not.toContain("test-only");
  const write = network.mock.calls.find(([url]) =>
    String(url).endsWith("/query"),
  );
  expect(JSON.parse(write[1].body).params.slice(1, 3)).toEqual([100, 10]);
});
it("preserves a recorded threshold crossing rather than reopening the daily allowance", async () => {
  vi.stubGlobal("fetch", remote({ floor: READ_LIMIT }));
  expect((await verifyOperations(env)).budget).toMatchObject({
    allowed: false,
    reason: "daily_70_percent_budget",
  });
});
it.each([{ denied: true }, { analyticsDenied: true }])(
  "fails activation on denied credentials before updating D1",
  async (settings) => {
    const network = remote(settings);
    vi.stubGlobal("fetch", network);
    await expect(verifyOperations(env)).rejects.toThrow();
    expect(
      network.mock.calls.some(([url]) => String(url).endsWith("/query")),
    ).toBe(false);
  },
);
