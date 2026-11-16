import type { Context, Next } from "hono";
export type Bindings = {
  [K in keyof Env]: Env[K] extends string ? string : Env[K];
} & {
  INTERNAL_SECRET?: string;
  RATE_LIMIT_SALT?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_SECRET?: string;
};
export type AppEnv = { Bindings: Bindings };
export const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function internalAuth(c: Context<AppEnv>, next: Next) {
  if (!c.env.INTERNAL_SECRET || c.env.INTERNAL_SECRET.length < 32)
    return c.json(
      {
        error: {
          code: "not_configured",
          message: "Internal operations are unavailable.",
        },
      },
      503,
    );
  const timestamp = c.req.header("X-Timestamp") ?? "",
    nonce = c.req.header("X-Nonce") ?? "",
    signature = c.req.header("X-Signature") ?? "";
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^[-a-zA-Z0-9]{16,100}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return c.json(
      {
        error: { code: "unauthorized", message: "Invalid request signature." },
      },
      401,
    );
  const url = new URL(c.req.url);
  const body = await c.req.text();
  const message = [
    c.req.method,
    url.pathname + url.search,
    timestamp,
    nonce,
    await digest(body),
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(c.env.INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = Uint8Array.from(signature.match(/../g)!, (s) => parseInt(s, 16));
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      new TextEncoder().encode(message),
    ))
  )
    return c.json(
      {
        error: { code: "unauthorized", message: "Invalid request signature." },
      },
      401,
    );
  const r = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO request_nonces(nonce,expires_at) VALUES(?,?)",
  )
    .bind(nonce, Math.floor(Date.now() / 1000) + 600)
    .run();
  if (!r.meta.changes)
    return c.json(
      { error: { code: "replay", message: "Request already used." } },
      409,
    );
  c.header("Cache-Control", "no-store");
  await next();
}
export async function verifyTurnstile(
  token: string,
  env: Bindings,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    return (
      response.ok &&
      result.success === true &&
      result.hostname === env.TURNSTILE_HOSTNAME &&
      result.action === "submit"
    );
  } catch {
    return false;
  }
}
