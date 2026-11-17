import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  canonicalizeUrl,
  submissionSchema,
  ingestSchema,
  moderationSchema,
} from "./validation";
import {
  digest,
  hmac,
  internalAuth,
  verifyTurnstile,
  type AppEnv,
} from "./security";
import { internal } from "./internal";
import { admin } from "./admin";
import { databaseQuota, quotaResponse } from "./availability";
import { blockedPage } from "./urgent-removal";
import { observedDatabase } from "./query-metrics";
import { operationsCron } from "./operations";
const app = new Hono<AppEnv>();
app.use("/api/*", async (c, next) => {
  const usage = { rows_read: 0, rows_written: 0, queries: 0 };
  const original = c.env.DB;
  c.env = { ...c.env, DB: observedDatabase(original, c.req.path, usage) };
  try {
    await next();
    c.header("X-D1-Rows-Read", String(usage.rows_read));
    c.header("X-D1-Rows-Written", String(usage.rows_written));
  } finally {
    c.env.DB = original;
  }
});
app.use("*", async (c, next) => {
  await next();
  c.header("X-Worker-Invocation", "1");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 131072,
    onError: (c) =>
      c.json(
        { error: { code: "too_large", message: "Request is too large." } },
        413,
      ),
  }),
);
app.onError(async (err, c) => {
  if (databaseQuota(err)) {
    const limited = quotaResponse(
      new Date(),
      c.req.path === "/api/admin/login",
    );
    console.error(
      JSON.stringify({ event: "database_daily_limit", path: c.req.path }),
    );
    return c.json({ error: limited.error }, 503, {
      "Retry-After": String(limited.retry),
      "Cache-Control": "no-store",
    });
  }
  if (err instanceof HTTPException)
    return c.json(
      {
        error: {
          code: "request_failed",
          message: "The request could not be processed.",
        },
      },
      err.status,
    );
  console.error(
    JSON.stringify({
      event: "request_failed",
      path: c.req.path,
      kind: err.name,
    }),
  );
  return c.json(
    {
      error: {
        code: "temporarily_unavailable",
        message:
          "The catalog is temporarily unavailable. Please try again later.",
      },
    },
    503,
    { "Retry-After": "3600" },
  );
});
app.post("/api/submit", async (c) => {
  if (
    c.env.SUBMISSIONS_ENABLED !== "true" ||
    !c.env.RATE_LIMIT_SALT ||
    !c.env.TURNSTILE_SECRET_KEY
  )
    return c.json(
      {
        error: {
          code: "not_configured",
          message: "Submissions are not available yet. Please check back.",
        },
      },
      503,
    );
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.env.SITE_URL).origin)
    return c.json(
      {
        error: { code: "invalid_origin", message: "Submit from this website." },
      },
      403,
    );
  const raw = await c.req.text();
  if (raw.length > 8192)
    return c.json(
      {
        error: {
          code: "too_large",
          message: "Keep the submission under 8 KB.",
        },
      },
      413,
    );
  let parsed;
  try {
    parsed = submissionSchema.safeParse(JSON.parse(raw));
  } catch {
    return c.json(
      { error: { code: "invalid_json", message: "Invalid JSON." } },
      400,
    );
  }
  if (!parsed.success)
    return c.json(
      {
        error: {
          code: "invalid_submission",
          message: parsed.error.issues[0].message,
        },
      },
      400,
    );
  const input = parsed.data;
  if (!(await verifyTurnstile(input.turnstile_token, c.env)))
    return c.json(
      {
        error: {
          code: "invalid_challenge",
          message:
            "Verification expired or failed. Please try the challenge again.",
        },
      },
      400,
    );
  const tokenKey = "turnstile-" + (await digest(input.turnstile_token));
  const used = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO request_nonces(nonce,expires_at) VALUES(?,?)",
  )
    .bind(tokenKey, Math.floor(Date.now() / 1000) + 600)
    .run();
  if (!used.meta.changes)
    return c.json(
      {
        error: {
          code: "duplicate_challenge",
          message: "Please complete a new challenge.",
        },
      },
      400,
    );
  const day = new Date().toISOString().slice(0, 10);
  const hashed = await hmac(
    c.env.RATE_LIMIT_SALT,
    day + ":" + (c.req.header("CF-Connecting-IP") ?? "local"),
  );
  const rate = await c.env.DB.prepare(
    "INSERT INTO submission_rate_limits(hashed_identifier,date_bucket,attempts,created_at) VALUES(?,?,1,?) ON CONFLICT(hashed_identifier,date_bucket) DO UPDATE SET attempts=attempts+1 WHERE attempts<5 RETURNING attempts",
  )
    .bind(hashed, day, new Date().toISOString())
    .first();
  if (!rate)
    return c.json(
      {
        error: {
          code: "rate_limited",
          message:
            "Five submissions a day is quite enough. Try again tomorrow.",
        },
      },
      429,
      { "Retry-After": "86400" },
    );
  const existing = await c.env.DB.prepare(
    "SELECT slug,name FROM products WHERE canonical_url=? AND status='published'",
  )
    .bind(input.submitted_url)
    .first();
  if (existing) return c.json({ status: "exists", product: existing }, 200);
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO submissions(id,product_name,submitted_url,description,category_hint,contact_email) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      id,
      input.product_name,
      input.submitted_url,
      input.description,
      input.category_hint ?? null,
      input.contact_email || null,
    )
    .run();
  return c.json(
    {
      status: "pending",
      message: inserted.meta.changes
        ? "Submission received. We'll check whether your app actually exists."
        : "This website already has a submission awaiting review.",
    },
    202,
  );
});
app.route("/api/admin", admin);
app.use("/api/internal/*", internalAuth);
app.route("/api/internal", internal);
// Only exact temporarily removed paths are routed here by the blocker deployment.
app.get("/apps/:slug", (c) =>
  blockedPage(c.env, c.req.param("slug"))
    ? c.text("This listing has been removed.", 410, {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      })
    : c.env.ASSETS.fetch(c.req.raw),
);
app.all("/api/*", (c) =>
  c.json({ error: { code: "not_found", message: "Endpoint not found." } }, 404),
);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export { app, canonicalizeUrl, ingestSchema, moderationSchema };
export default { fetch: app.fetch, scheduled: operationsCron };
