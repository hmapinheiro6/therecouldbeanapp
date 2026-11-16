import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { MAX_QUERY_LENGTH } from "../src/lib/search/limits";
import { parseQuery } from "../src/lib/search/query";
import { rank, verdict } from "../src/lib/search/rank";
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
import {
  getProduct,
  hydrate,
  PRODUCT_SELECT,
  RETRIEVAL_SQL,
  type ProductRow,
} from "./catalog";
import { internal } from "./internal";
import { admin } from "./admin";
import { escapeHtml, productSummary } from "./seo";
import {
  databaseQuota,
  quotaResponse,
  cachePublicAggregate,
} from "./availability";
import { previewResponse } from "./previews";
const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  await next();
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
    if (
      c.req.method === "GET" &&
      /^\/apps\/[a-z0-9-]{1,100}$/.test(c.req.path)
    ) {
      const asset = await c.env.ASSETS.fetch(
        new Request(
          new URL("/catalog-pages/" + c.req.path.slice(6) + ".html", c.req.url),
        ),
      );
      if (asset.ok)
        return new Response(asset.body, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
            "Cache-Control": "no-store",
            "X-Catalog-Mode": "snapshot",
          },
        });
    }
    if (c.req.method === "GET" && c.req.path === "/sitemap.xml") {
      const asset = await c.env.ASSETS.fetch(
        new Request(new URL("/catalog-backup-sitemap.xml", c.req.url)),
      );
      if (asset.ok) return asset;
    }
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
app.get("/api/config", (c) =>
  c.json({
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY,
    submissions_enabled:
      c.env.SUBMISSIONS_ENABLED === "true" &&
      !!c.env.TURNSTILE_SECRET_KEY &&
      !!c.env.RATE_LIMIT_SALT,
  }),
);
app.get("/api/health", async (c) => {
  const r = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT status,started_at,completed_at,records_accepted,records_rejected,records_pending FROM ingestion_runs ORDER BY started_at DESC LIMIT 10",
    ),
    c.env.DB.prepare(
      "SELECT count(*) count FROM ingestion_candidates WHERE status IN ('pending_verification','needs_review')",
    ),
  ]);
  const runs = r[0].results as {
    status: string;
    completed_at: string | null;
    started_at: string;
    records_accepted: number;
    records_rejected: number;
    records_pending: number;
  }[];
  const last = runs.find((r) => r.status === "success");
  let failures = 0;
  for (const run of runs) {
    if (run.status === "success") break;
    if (
      run.status === "failed" ||
      run.status === "partial" ||
      (run.status === "running" &&
        Date.parse(run.started_at) < Date.now() - 3600000)
    )
      failures++;
  }
  return c.json({
    status: "ok",
    search: "classical",
    timestamp: new Date().toISOString(),
    ingestion: {
      enabled: c.env.INGESTION_ENABLED === "true",
      last_successful_run: last?.completed_at ?? null,
      records_added: last?.records_accepted ?? 0,
      records_rejected: last?.records_rejected ?? 0,
      pending_review:
        (r[1].results[0] as { count: number } | undefined)?.count ?? 0,
      consecutive_failures_in_last_10: failures,
    },
  });
});
app.use("/api/categories", cachePublicAggregate);
app.use("/api/stats", cachePublicAggregate);
app.get("/api/categories", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT c.slug,c.name,COUNT(p.id) product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.status='published' GROUP BY c.id ORDER BY c.name",
  ).all();
  return c.json({ categories: r.results }, 200, {
    "Cache-Control": "public, max-age=300",
  });
});
app.get("/api/stats", async (c) => {
  const stats = await c.env.DB.prepare(
    "SELECT COUNT(*) products,MAX(last_verified_at) catalog_updated_at FROM products WHERE status='published'",
  ).first();
  const health = await c.env.DB.prepare(
    "SELECT completed_at,records_accepted,records_rejected,records_pending FROM ingestion_runs WHERE status='success' ORDER BY completed_at DESC LIMIT 1",
  ).first();
  return c.json({ ...stats, ingestion: health }, 200, {
    "Cache-Control": "public, max-age=300",
  });
});
// Forward-only published identities for the hosted preview backfill. Primary-key bounded;
// never reads private queues or scans the full product table on every run.
app.get("/api/preview-products", async (c) => {
  const after = Number(c.req.query("after") ?? 0);
  if (!Number.isSafeInteger(after) || after < 0 || after > 1_000_000_000)
    return c.json(
      { error: { code: "invalid_cursor", message: "Invalid preview cursor." } },
      400,
    );
  const latest = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(id),0) latest FROM products",
  ).first<{ latest: number }>();
  const ceiling = Math.min(after + 500, latest?.latest ?? 0);
  const rows =
    ceiling > after
      ? await c.env.DB.prepare(
          "SELECT id,slug,name,canonical_url,verification_scope,first_seen_at FROM products WHERE id>? AND id<=? AND status='published' ORDER BY id LIMIT 100",
        )
          .bind(after, ceiling)
          .all()
      : { results: [] };
  const last = rows.results.at(-1) as { id: number } | undefined;
  const next =
    rows.results.length === 100 ? last!.id : Math.max(after, ceiling);
  return c.json(
    {
      products: rows.results,
      next_after: next,
      has_more: next < (latest?.latest ?? 0),
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
});
app.get("/api/previews/:slug", (c) =>
  previewResponse(c.req.raw, c.req.param("slug"), c.env.ASSETS),
);
app.get("/api/search", async (c) => {
  const started = performance.now();
  const q = (c.req.query("q") ?? "").trim();
  const offset = Number(c.req.query("offset") ?? 0);
  if (
    q.length < 2 ||
    q.length > MAX_QUERY_LENGTH ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 60
  )
    return c.json(
      {
        error: {
          code: "invalid_query",
          message: `Describe an idea using 2–${MAX_QUERY_LENGTH} characters and a valid page.`,
        },
      },
      400,
    );
  const intent = parseQuery(q);
  if (!intent.fts)
    return c.json(
      {
        error: {
          code: "invalid_query",
          message: "Add a little more detail about what your app does.",
        },
      },
      400,
    );
  // Both the FTS expression and the SQL parameters are bounded and generated safely.
  const retrieved = await c.env.DB.prepare(RETRIEVAL_SQL)
    .bind(intent.fts)
    .all<ProductRow>();
  const ranked = rank(await hydrate(c.env.DB, retrieved.results), intent);
  console.log(
    JSON.stringify({
      event: "search",
      retrieved: retrieved.results.length,
      returned: ranked.length,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      retrieval_rows_read: retrieved.meta.rows_read,
    }),
  );
  const summary = {
    strong: ranked.filter((p) => p.match_class === "Strong match").length,
    partial: ranked.filter((p) => p.match_class === "Partial match").length,
    related: ranked.filter((p) => p.match_class === "Related product").length,
  };
  return c.json(
    {
      query: q,
      requested: intent.capabilities,
      qualifiers: intent.qualifiers,
      summary,
      verdict: verdict(summary.strong, summary.partial, summary.related),
      results: ranked.slice(offset, offset + 20),
      total: ranked.length,
      limit: 20,
      offset,
      candidate_limit: 80,
      catalog_updated_at: ranked.reduce<string | null>(
        (d, p) => (!d || p.last_verified_at > d ? p.last_verified_at : d),
        null,
      ),
      elapsed_ms: Math.round((performance.now() - started) * 100) / 100,
    },
    200,
    { "Cache-Control": "no-store" },
  );
});
app.get("/api/products", async (c) => {
  const category = c.req.query("category") ?? "";
  const sort = c.req.query("sort") ?? "name";
  const offset = Number(c.req.query("offset") ?? 0);
  if (
    category.length > 80 ||
    !["name", "recent"].includes(sort) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    return c.json(
      { error: { code: "invalid_page", message: "Invalid catalog page." } },
      400,
    );
  const r = await c.env.DB.prepare(
    `${PRODUCT_SELECT},0 bm25 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.status='published' AND (?='' OR c.slug=?) ORDER BY ${sort === "recent" ? "p.first_seen_at DESC,p.id DESC" : "p.name,p.id"} LIMIT 24 OFFSET ?`,
  )
    .bind(category, category, offset)
    .all<ProductRow>();
  return c.json(
    { products: await hydrate(c.env.DB, r.results), offset, limit: 24 },
    200,
    { "Cache-Control": "public, max-age=300" },
  );
});
app.get("/api/products/:slug", async (c) => {
  const p = await getProduct(c.env.DB, c.req.param("slug"));
  return p
    ? c.json(p, 200, { "Cache-Control": "public, max-age=300" })
    : c.json(
        {
          error: {
            code: "not_found",
            message: "This app is not in the published catalog.",
          },
        },
        404,
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
app.get("/sitemap.xml", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT slug FROM products WHERE status='published' ORDER BY id LIMIT 10000",
  ).all<{ slug: string }>();
  const base = new URL(c.env.SITE_URL).origin;
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", "/about", "/submit", ...rows.results.map((p) => "/apps/" + p.slug)].map((path) => `<url><loc>${base}${path}</loc></url>`).join("")}</urlset>`,
    200,
    {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  );
});
app.get("/apps/:slug", async (c) => {
  const p = await getProduct(c.env.DB, c.req.param("slug"));
  const asset = await c.env.ASSETS.fetch(
    new Request(new URL("/index.html", c.req.url)),
  );
  const title = p
    ? `${p.name} — There Could Be An App`
    : "App not found — There Could Be An App";
  const description =
    p?.short_description ?? "This app is not in the published catalog.";
  const canonical = new URL(
    "/apps/" + c.req.param("slug"),
    c.env.SITE_URL,
  ).toString();
  const structured = p
    ? JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: p.name,
        url: p.canonical_url,
        description: p.short_description,
        applicationCategory: p.category,
      }).replace(/</g, "\\u003c")
    : "";
  const html = new HTMLRewriter()
    .on('link[rel="canonical"]', {
      element(e) {
        e.remove();
      },
    })
    .on("head", {
      element(e) {
        e.append(
          `<link rel="canonical" href="${escapeHtml(canonical)}"/><meta property="og:url" content="${escapeHtml(canonical)}"/>`,
          { html: true },
        );
      },
    })
    .on("head", {
      element(e) {
        if (structured)
          e.append(
            '<script type="application/ld+json">' + structured + "</script>",
            { html: true },
          );
      },
    })
    .on("#root", {
      element(e) {
        if (p) e.setInnerContent(productSummary(p), { html: true });
      },
    })
    .on("title", {
      element(e) {
        e.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', {
      element(e) {
        e.setAttribute("content", description);
      },
    })
    .on('meta[property="og:title"]', {
      element(e) {
        e.setAttribute("content", title);
      },
    })
    .on('meta[property="og:description"]', {
      element(e) {
        e.setAttribute("content", description);
      },
    })
    .transform(asset);
  return new Response(html.body, {
    status: p ? 200 : 404,
    headers: html.headers,
  });
});
app.all("/api/*", (c) =>
  c.json({ error: { code: "not_found", message: "Endpoint not found." } }, 404),
);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export { app, canonicalizeUrl, ingestSchema, moderationSchema };
export default app;
