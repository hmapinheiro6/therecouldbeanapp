import { parseIntelligence } from "../src/lib/intelligence";
const MAX_BYTES = 32 * 1024;
const ORIGIN =
  "https://raw.githubusercontent.com/hmapinheiro6/therecouldbeanapp/main/public/catalog-intelligence/";
async function readIntelligence(response: Response, slug: string) {
  if (
    !response.ok ||
    Number(response.headers.get("Content-Length") ?? 0) > MAX_BYTES ||
    !response.body
  )
    return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(joined));
    return parseIntelligence(value, slug);
  } catch {
    return null;
  }
}
/** Fixed public repository paths only. No database, arbitrary URL proxy or live product fetch. */
export async function intelligenceResponse(
  request: Request,
  slug: string,
  assets: Fetcher,
  fetcher: typeof fetch = fetch,
  cache: Cache | undefined = typeof caches !== "undefined"
    ? (caches as CacheStorage & { default: Cache }).default
    : undefined,
) {
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    return new Response(null, { status: 404 });
  const key = new Request(
    new URL("/api/intelligence/" + slug + "?schema=1", request.url),
  );
  try {
    const hit = await cache?.match(key);
    if (hit) return hit;
  } catch {
    /* Optional edge cache. */
  }
  let preview = null;
  let source = "missing";
  let upstreamStatus = "unavailable";
  try {
    const upstream = await fetcher(ORIGIN + slug + ".json", {
      // Workers supports manual/follow only. Non-2xx responses are rejected below.
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
      headers: {
        Accept: "application/json",
        "User-Agent": "ThereCouldBeAnApp/1.0",
      },
    });
    upstreamStatus = String(upstream.status);
    preview = await readIntelligence(upstream, slug);
    if (preview) source = "repository";
    else if (upstream.ok) upstreamStatus = "invalid-record";
  } catch (error) {
    upstreamStatus = error instanceof Error ? error.name : "unavailable";
    /* A cached build copy remains usable when GitHub is unreachable. */
  }
  if (!preview) {
    try {
      preview = await readIntelligence(
        await assets.fetch(
          new Request(
            new URL("/catalog-intelligence/" + slug + ".json", request.url),
          ),
        ),
        slug,
      );
    } catch {
      /* Previews are optional. */
    }
  }
  if (preview && source === "missing") source = "bundle";
  const response = preview
    ? Response.json(preview, {
        headers: {
          "Cache-Control": "public, max-age=21600, s-maxage=21600",
          "X-Content-Type-Options": "nosniff",
        },
      })
    : Response.json(null, {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
  response.headers.set("X-Observation-Source", source);
  response.headers.set("X-Observation-Upstream", upstreamStatus);
  try {
    await cache?.put(key, response.clone());
  } catch {
    /* Never fail the card for a cache error. */
  }
  return response;
}
