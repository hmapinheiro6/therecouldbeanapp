import { it, expect, vi } from "vitest";
import { recoveryResponse } from "../../worker/recovery";
it("uses a fixed hosted recovery path and falls back to the build without D1", async () => {
  const assets = {
    fetch: vi.fn(async () => Response.json({ products: ["bundled"] })),
  } as unknown as Fetcher;
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ products: ["hosted"] }),
  );
  const request = new Request(
    "https://catalog.dev/catalog-backup.json?url=https://evil.dev",
  );
  const fresh = await recoveryResponse(
    request,
    assets,
    fetcher as typeof fetch,
    undefined,
  );
  expect(await fresh.json()).toEqual({ products: ["hosted"] });
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://raw.githubusercontent.com/hmapinheiro6/therecouldbeanapp/main/public/catalog-backup.json",
  );
  expect(assets.fetch).not.toHaveBeenCalled();
  const offline = await recoveryResponse(
    request,
    assets,
    (async () => {
      throw new Error("offline");
    }) as typeof fetch,
    undefined,
  );
  expect(await offline.json()).toEqual({ products: ["bundled"] });
});
it("rejects redirects and oversized hosted recovery artifacts", async () => {
  const assets = {
    fetch: vi.fn(async () => new Response("bundled")),
  } as unknown as Fetcher;
  for (const response of [
    new Response(null, {
      status: 302,
      headers: { Location: "https://evil.dev" },
    }),
    new Response("large", {
      headers: { "Content-Length": String(25 * 1024 * 1024) },
    }),
  ]) {
    expect(
      await (
        await recoveryResponse(
          new Request("https://catalog.dev/catalog-backup.json"),
          assets,
          (async () => response) as typeof fetch,
          undefined,
        )
      ).text(),
    ).toBe("bundled");
  }
});
