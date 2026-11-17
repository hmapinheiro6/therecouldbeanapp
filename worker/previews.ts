import { publicPreview, validPreview } from "../src/lib/previews";
const MAX_BYTES = 48 * 1024;
const ORIGIN =
  "https://raw.githubusercontent.com/hmapinheiro6/therecouldbeanapp/main/public/catalog-previews/";
async function readPreview(response: Response, slug: string) {
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
    return validPreview(value, slug) &&
      (value.title || value.description || value.image)
      ? publicPreview(value)
      : null;
  } catch {
    return null;
  }
}
/** Fixed public repository paths only. No database, arbitrary URL proxy or live product fetch. */
export async function previewResponse(
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
  const key = new Request(new URL("/api/previews/" + slug, request.url));
  try {
    const hit = await cache?.match(key);
    if (hit) return hit;
  } catch {
    /* Optional edge cache. */
  }
  let preview = null;
  try {
    preview = await readPreview(
      await fetcher(ORIGIN + slug + ".json", {
        // Workers supports manual/follow only. Non-2xx responses are rejected below.
        redirect: "manual",
        signal: AbortSignal.timeout(2500),
        headers: { Accept: "application/json" },
      }),
      slug,
    );
  } catch {
    /* A cached build copy remains usable when GitHub is unreachable. */
  }
  if (!preview) {
    try {
      preview = await readPreview(
        await assets.fetch(
          new Request(
            new URL("/catalog-previews/" + slug + ".json", request.url),
          ),
        ),
        slug,
      );
    } catch {
      /* Previews are optional. */
    }
  }
  const response = preview
    ? Response.json(preview, {
        headers: {
          "Cache-Control": "public, max-age=21600, s-maxage=86400",
          "X-Content-Type-Options": "nosniff",
        },
      })
    : Response.json(null, {
        headers: { "Cache-Control": "public, max-age=3600" },
      });
  try {
    await cache?.put(key, response.clone());
  } catch {
    /* Never fail the card for a cache error. */
  }
  return response;
}
