import { describe, it, expect, vi } from "vitest";
import { previewResponse } from "../../worker/previews";
import { validPreview } from "../../src/lib/previews";
const preview = {
  version: 1,
  slug: "actual",
  canonical_url: "https://actual.dev",
  source_url: "https://actual.dev/",
  checked_at: "2026-11-16T12:00:00Z",
  title: "Publisher title",
  description: "Publisher description",
  image: null,
};
const assets = {
  fetch: vi.fn(async () => new Response(null, { status: 404 })),
} as unknown as Fetcher;
const request = new Request(
  "https://catalog.dev/api/previews/actual?ignored=1",
);
describe("optional public previews", () => {
  it("reads a fixed public repository path, strips extra fields and caches without D1", async () => {
    const remote = vi.fn(async () =>
      Response.json({ ...preview, private_field: "must not escape" }),
    );
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    } as unknown as Cache;
    const response = await previewResponse(
      request,
      "actual",
      assets,
      remote as typeof fetch,
      cache,
    );
    expect(await response.json()).toEqual(preview);
    expect((remote.mock.calls as unknown as [string][])[0]?.[0]).toBe(
      "https://raw.githubusercontent.com/hmapinheiro6/therecouldbeanapp/main/public/catalog-previews/actual.json",
    );
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=86400");
    expect(cache.put).toHaveBeenCalledOnce();
    expect(
      (remote.mock.calls as unknown as [string, RequestInit][])[0][1].redirect,
    ).toBe("manual");
  });
  it("rejects an upstream redirect without following an arbitrary destination", async () => {
    const remote = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://unrelated.dev" },
        }),
    );
    const response = await previewResponse(
      request,
      "actual",
      assets,
      remote as typeof fetch,
      undefined,
    );
    expect(await response.json()).toBeNull();
    expect(remote).toHaveBeenCalledOnce();
  });
  it("serves cached previews without upstream work", async () => {
    const cached = Response.json(preview);
    const cache = { match: async () => cached } as unknown as Cache;
    const remote = vi.fn();
    expect(
      await previewResponse(request, "actual", assets, remote, cache),
    ).toBe(cached);
    expect(remote).not.toHaveBeenCalled();
  });
  it("falls back to the bundled preview when the public upstream is unavailable", async () => {
    const bundled = {
      fetch: async () => Response.json(preview),
    } as unknown as Fetcher;
    const response = await previewResponse(
      request,
      "actual",
      bundled,
      async () => {
        throw new Error("offline");
      },
      undefined,
    );
    expect(await response.json()).toEqual(preview);
  });
  it("returns an empty cacheable fallback for missing, oversized, hostile and malformed previews", async () => {
    for (const body of [
      "bad-json",
      "x".repeat(50 * 1024),
      JSON.stringify({
        ...preview,
        image: { data: "data:image/svg+xml,<svg>" },
      }),
      JSON.stringify({ ...preview, source_url: "https://different.dev" }),
    ]) {
      const response = await previewResponse(
        request,
        "actual",
        assets,
        async () => new Response(body),
        undefined,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toBeNull();
      expect(response.headers.get("Cache-Control")).toContain("max-age=3600");
    }
  });
  it("rejects path traversal before fetching and never accepts HTML text or scripts", async () => {
    const remote = vi.fn();
    expect(
      (await previewResponse(request, "../../private", assets, remote)).status,
    ).toBe(404);
    expect(remote).not.toHaveBeenCalled();
    expect(
      validPreview(
        { ...preview, title: "<script>alert(1)</script>" },
        "actual",
      ),
    ).toBe(false);
  });
});
