// Do not log exception text: provider errors can contain private query parameters.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./security";
export function databaseQuota(error: unknown): boolean {
  let value = error;
  for (let i = 0; i < 4 && value; i++) {
    if (value instanceof Error) {
      if (
        /exceeded.*(?:free tier daily row|daily.*(?:read|write)).*limit/i.test(
          value.message,
        )
      )
        return true;
      value = value.cause;
    } else break;
  }
  return false;
}
export const cachePublicAggregate: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const cache =
    typeof caches !== "undefined"
      ? (caches as CacheStorage & { default: Cache }).default
      : undefined;
  if (c.req.method !== "GET" || !cache) return next();
  const key = new Request(new URL(c.req.path, c.req.url));
  try {
    const hit = await cache.match(key);
    if (hit) return hit;
  } catch {
    /* Cache availability must not take down the underlying route. */
  }
  await next();
  if (c.res.status === 200) {
    try {
      await cache.put(key, c.res.clone());
    } catch {
      /* Optional aggregate cache. */
    }
  }
};
export function quotaResponse(now = new Date(), signingIn = false) {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  const retry = Math.max(
    1,
    Math.ceil((reset.getTime() - now.getTime()) / 1000),
  );
  const day = reset.toISOString().slice(0, 10);
  return {
    error: {
      code: "database_daily_limit",
      message: `The daily database allowance is used up. Sign-in and publishing can resume after ${day} at 00:00 UTC.${signingIn ? " Your access key has not been checked." : ""} Public browsing and search use the saved catalog copy.`,
      reset_at: reset.toISOString(),
    },
    retry,
  };
}
