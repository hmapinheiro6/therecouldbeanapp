import { describe, it, expect, vi } from "vitest";
import { intelligenceResponse } from "../../worker/intelligence";
import { parseIntelligence, websiteLabel } from "../../src/lib/intelligence";
import fixture from "../intelligence-fixture.json";
import { app } from "../../worker/index";
import type { Bindings } from "../../worker/security";
const assets = {
  fetch: vi.fn(async () => new Response(null, { status: 404 })),
} as unknown as Fetcher;
const request = new Request(
  "https://catalog.dev/api/intelligence/otter?url=https://evil.dev",
);
describe("dated public observations without D1", () => {
  it("the public route serves observations even when the D1 binding would throw", async () => {
    const database = {
      prepare: vi.fn(() => {
        throw new Error("D1 daily limit");
      }),
    };
    vi.stubGlobal("fetch", async () => Response.json(fixture));
    try {
      const response = await app.request("/api/intelligence/otter", {}, {
        DB: database,
        ASSETS: assets,
      } as unknown as Bindings);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(fixture);
      expect(database.prepare).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("only reads its fixed public path and strips private fields at every level", async () => {
    const remote = vi.fn(async () =>
      Response.json({
        ...fixture,
        private_key: "secret",
        facts: { ...fixture.facts, private_fact: { value: "private" } },
        website: { ...fixture.website, debug: "private" },
      }),
    );
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const response = await intelligenceResponse(
      request,
      "otter",
      assets,
      remote as typeof fetch,
      cache,
    );
    expect(await response.json()).toEqual(fixture);
    expect((remote.mock.calls as unknown as [string][])[0][0]).toBe(
      "https://raw.githubusercontent.com/hmapinheiro6/therecouldbeanapp/main/public/catalog-intelligence/otter.json",
    );
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=21600");
    expect(cache.put).toHaveBeenCalledOnce();
  });
  it("serves the edge cache before any upstream work and falls back to bundled records", async () => {
    const hit = Response.json(fixture);
    const remote = vi.fn();
    expect(
      await intelligenceResponse(request, "otter", assets, remote, {
        match: async () => hit,
      } as unknown as Cache),
    ).toBe(hit);
    expect(remote).not.toHaveBeenCalled();
    const response = await intelligenceResponse(
      request,
      "otter",
      { fetch: async () => Response.json(fixture) } as unknown as Fetcher,
      async () => {
        throw new Error("offline");
      },
      undefined,
    );
    expect(await response.json()).toEqual(fixture);
  });
  it("fails closed for oversized and invalid records; missing observations cache as JSON null", async () => {
    for (const body of [
      "bad-json",
      "x".repeat(32769),
      JSON.stringify({ ...fixture, slug: "wrong" }),
      JSON.stringify({
        ...fixture,
        history: [...fixture.history, ...Array(32).fill(fixture.history[0])],
      }),
      JSON.stringify({
        ...fixture,
        facts: {
          publication: {
            ...fixture.facts.publication,
            source_url: "https://unrelated.dev",
          },
        },
      }),
    ]) {
      const response = await intelligenceResponse(
        request,
        "otter",
        assets,
        async () => new Response(body),
        undefined,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toBeNull();
      expect(response.headers.get("Cache-Control")).toContain("max-age=3600");
    }
    const remote = vi.fn();
    expect(
      (await intelligenceResponse(request, "../../private", assets, remote))
        .status,
    ).toBe(404);
    expect(remote).not.toHaveBeenCalled();
  });
  it("rejects invented dates, hostile values and reversed or repeated daily observations", () => {
    expect(
      parseIntelligence(
        {
          ...fixture,
          facts: {
            publication: { ...fixture.facts.publication, date: "2020" },
          },
        },
        "otter",
      ),
    ).toBeNull();
    expect(
      parseIntelligence(
        {
          ...fixture,
          facts: {
            publication: { ...fixture.facts.publication, date: "2099-01-01" },
          },
        },
        "otter",
      ),
    ).toBeNull();
    expect(
      parseIntelligence(
        {
          ...fixture,
          facts: {
            version: { ...fixture.facts.publication, value: "<script>" },
          },
        },
        "otter",
      ),
    ).toBeNull();
    expect(
      parseIntelligence(
        { ...fixture, checks: [...fixture.checks, ...fixture.checks] },
        "otter",
      ),
    ).toBeNull();
  });
  it("labels repeated failures without declaring closure or verified service uptime", () => {
    const p = parseIntelligence(fixture, "otter")!;
    expect(websiteLabel(p)).toBe("Website reachable");
    p.website.state = "unreachable";
    p.website.failed_observation_days = 3;
    expect(websiteLabel(p)).toBe("Repeatedly unreachable");
    p.website.state = "restricted";
    expect(websiteLabel(p)).toBe("Automated check restricted");
  });
});
