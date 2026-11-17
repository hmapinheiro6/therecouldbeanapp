const ORIGIN =
  "https://raw.githubusercontent.com/hmapinheiro6/therecouldbeanapp/main/public/catalog-backup.json";
const MAX_BYTES = 24 * 1024 * 1024;
/** A fixed public recovery artifact, refreshed by hosted jobs without deployment or D1. */
export async function recoveryResponse(
  request: Request,
  assets: Fetcher,
  fetcher: typeof fetch = fetch,
  cache: Cache | undefined = typeof caches !== "undefined"
    ? (caches as CacheStorage & { default: Cache }).default
    : undefined,
) {
  const key = new Request(new URL("/catalog-backup.json", request.url));
  try {
    const hit = await cache?.match(key);
    if (hit) return hit;
  } catch {
    /* Optional cache. */
  }
  try {
    const upstream = await fetcher(ORIGIN, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (
      upstream.ok &&
      upstream.body &&
      Number(upstream.headers.get("Content-Length") ?? 0) <= MAX_BYTES
    ) {
      let bytes = 0;
      const bounded = upstream.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > MAX_BYTES)
              throw new Error(
                "Public recovery artifact exceeds its size bound",
              );
            controller.enqueue(chunk);
          },
        }),
      );
      const response = new Response(bounded, {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "public, max-age=300, s-maxage=300",
          "X-Catalog-Recovery": "repository",
        },
      });
      // Await the bounded stream so a truncated/oversized artifact falls back.
      if (cache) await cache.put(key, response.clone());
      return response;
    }
  } catch {
    /* The deployment's saved public copy remains available. */
  }
  return assets.fetch(
    new Request(new URL("/catalog-backup.json", request.url)),
  );
}
