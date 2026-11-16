import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { digest, type AppEnv } from "./security";
import { productInput } from "./validation";
import { internal } from "./internal";
import { hydrate, PRODUCT_SELECT, type ProductRow } from "./catalog";
const admin = new Hono<AppEnv>();
const local = (url: string) => {
  const u = new URL(url);
  return (
    u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)
  );
};
const cookieName = (url: string) =>
  local(url) ? "tcba-admin-local" : "__Host-tcba-admin";
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
admin.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("Referrer-Policy", "no-referrer");
  if (!c.env.ADMIN_SECRET || c.env.ADMIN_SECRET.length < 32)
    return c.json(
      { error: { message: "Admin access has not been configured." } },
      503,
    );
  if (
    c.req.method !== "GET" &&
    c.req.header("Origin") !== new URL(c.env.SITE_URL).origin
  )
    return c.json(
      { error: { message: "Request origin is not allowed." } },
      403,
    );
  if (c.req.path.endsWith("/login")) return next();
  const token = getCookie(c, cookieName(c.req.url)) ?? "";
  if (!/^[a-f0-9]{64}$/.test(token))
    return c.json(
      { error: { message: "Sign in to review the catalog." } },
      401,
    );
  const session = await c.env.DB.prepare(
    "SELECT token_hash FROM admin_sessions WHERE token_hash=? AND secret_version=? AND expires_at>?",
  )
    .bind(
      await digest(token),
      await digest(c.env.ADMIN_SECRET),
      Math.floor(Date.now() / 1000),
    )
    .first();
  if (!session)
    return c.json(
      { error: { message: "Your session has expired. Sign in again." } },
      401,
    );
  await next();
});
admin.post("/login", async (c) => {
  const input = z
    .object({ key: z.string().min(32).max(128) })
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success)
    return c.json(
      { error: { message: "Enter the private admin access key." } },
      400,
    );
  const window = Math.floor(Date.now() / 900000);
  const id = await digest(
    c.env.ADMIN_SECRET +
      ":" +
      (c.req.header("CF-Connecting-IP") ?? "local") +
      ":" +
      window,
  );
  await c.env.DB.prepare(
    "INSERT INTO admin_login_limits(id,window,attempts) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1",
  )
    .bind(id, window)
    .run();
  const limit = await c.env.DB.prepare(
    "SELECT attempts FROM admin_login_limits WHERE id=?",
  )
    .bind(id)
    .first<{ attempts: number }>();
  if ((limit?.attempts ?? 0) > 10)
    return c.json(
      {
        error: {
          message: "Too many sign-in attempts. Try again in 15 minutes.",
        },
      },
      429,
    );
  const a = await digest(input.data.key),
    b = await digest(c.env.ADMIN_SECRET!);
  let different = 0;
  for (let i = 0; i < a.length; i++)
    different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (different)
    return c.json({ error: { message: "The access key is incorrect." } }, 401);
  const token = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<?").bind(
      Math.floor(Date.now() / 1000),
    ),
    c.env.DB.prepare("DELETE FROM admin_login_limits WHERE window<?").bind(
      window - 2,
    ),
    c.env.DB.prepare(
      "INSERT INTO admin_sessions(token_hash,secret_version,expires_at) VALUES(?,?,?)",
    ).bind(await digest(token), b, Math.floor(Date.now() / 1000) + 28800),
  ]);
  setCookie(c, cookieName(c.req.url), token, {
    path: "/",
    httpOnly: true,
    secure: !local(c.req.url),
    sameSite: "Strict",
    maxAge: 28800,
  });
  return c.json({ authenticated: true });
});
admin.get("/session", (c) => c.json({ authenticated: true }));
admin.post("/logout", async (c) => {
  const token = getCookie(c, cookieName(c.req.url)) ?? "";
  await c.env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?")
    .bind(await digest(token))
    .run();
  deleteCookie(c, cookieName(c.req.url), {
    path: "/",
    secure: !local(c.req.url),
    httpOnly: true,
    sameSite: "Strict",
  });
  return c.json({ authenticated: false });
});
admin.get("/overview", async (c) => {
  const r = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT verification_scope,count(*) count FROM products WHERE status='published' GROUP BY verification_scope",
    ),
    c.env.DB.prepare(
      "SELECT status,count(*) count FROM ingestion_candidates GROUP BY status",
    ),
    c.env.DB.prepare(
      "SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 12",
    ),
    c.env.DB.prepare("SELECT * FROM ingestion_checkpoints"),
    c.env.DB.prepare("SELECT slug,name FROM categories ORDER BY name"),
    c.env.DB.prepare("SELECT slug,name FROM capabilities ORDER BY name"),
  ]);
  return c.json({
    published: r[0].results,
    queue: r[1].results,
    runs: r[2].results,
    checkpoints: r[3].results,
    categories: r[4].results,
    capabilities: r[5].results,
  });
});
admin.get("/queue", async (c) => {
  const kind =
    c.req.query("kind") === "product"
      ? "product"
      : c.req.query("kind") === "submission"
        ? "submission"
        : "candidate";
  const status = c.req.query("status") ?? "needs_review";
  const offset = Number(c.req.query("offset") ?? 0);
  const search = (c.req.query("q") ?? "").slice(0, 100);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    ![
      "all",
      "needs_review",
      "pending_verification",
      "published",
      "rejected",
      "pending",
      "approved",
    ].includes(status)
  )
    return c.json({ error: { message: "Invalid queue filter." } }, 400);
  const query =
    kind === "product"
      ? "SELECT p.slug id,p.name,p.canonical_url,COALESCE((SELECT source_name FROM product_sources WHERE product_id=p.id LIMIT 1),'Catalog') source_name,COALESCE((SELECT source_url FROM product_sources WHERE product_id=p.id LIMIT 1),p.canonical_url) source_url,p.status,NULL reason,p.first_seen_at created_at,NULL review_draft_json FROM products p WHERE (?='all' OR p.status=?) AND (p.name LIKE ? OR p.canonical_url LIKE ?) ORDER BY p.first_seen_at DESC,p.id LIMIT 31 OFFSET ?"
      : kind === "candidate"
        ? "SELECT id,name,canonical_url,source_name,source_url,status,reason,created_at,review_draft_json FROM ingestion_candidates WHERE (?='all' OR status=?) AND (name LIKE ? OR canonical_url LIKE ?) ORDER BY created_at DESC,id LIMIT 31 OFFSET ?"
        : "SELECT id,product_name name,submitted_url canonical_url,'Submissions' source_name,submitted_url source_url,status,moderation_reason reason,created_at,description FROM submissions WHERE (?='all' OR status=?) AND (product_name LIKE ? OR submitted_url LIKE ?) ORDER BY created_at DESC,id LIMIT 31 OFFSET ?";
  const r = await c.env.DB.prepare(query)
    .bind(status, status, "%" + search + "%", "%" + search + "%", offset)
    .all();
  return c.json({
    records: r.results.slice(0, 30),
    has_more: r.results.length > 30,
    offset,
    kind,
  });
});
admin.get("/draft", async (c) => {
  const id = c.req.query("id") ?? "";
  const kind =
    c.req.query("kind") === "product"
      ? "product"
      : c.req.query("kind") === "submission"
        ? "submission"
        : "candidate";
  if (!id || id.length > 100)
    return c.json({ error: { message: "Invalid review record." } }, 400);
  const record = await c.env.DB.prepare(
    kind === "product"
      ? "SELECT canonical_url FROM products WHERE slug=?"
      : kind === "candidate"
        ? "SELECT canonical_url FROM ingestion_candidates WHERE id=?"
        : "SELECT submitted_url canonical_url FROM submissions WHERE id=?",
  )
    .bind(id)
    .first<{ canonical_url: string }>();
  if (!record) return c.json({ error: { message: "Record not found." } }, 404);
  const row = await c.env.DB.prepare(
    `${PRODUCT_SELECT},p.search_aliases,0 bm25 FROM products p JOIN categories c ON c.id=p.category_id WHERE p.canonical_url=?`,
  )
    .bind(record.canonical_url)
    .first<ProductRow & { search_aliases: string }>();
  if (!row) return c.json({ product: null });
  const [p] = await hydrate(c.env.DB, [row]);
  return c.json({
    product: {
      slug: p.slug,
      name: p.name,
      canonical_url: p.canonical_url,
      short_description: p.short_description,
      audience: p.audience,
      search_aliases: row.search_aliases,
      category_slug: p.category_slug,
      verification_scope: p.verification_scope,
      identity_evidence_url: p.identity_evidence_url ?? p.canonical_url,
      identity_evidence_text: p.identity_evidence_text ?? "",
      capabilities: p.capabilities,
    },
  });
});
admin.post("/review", async (c) => {
  const input = z
    .object({
      kind: z.enum(["candidate", "submission", "product"]),
      id: z.string().min(1).max(100),
      action: z.enum(["publish", "reject", "retry", "save"]),
      reason: z.string().trim().min(3).max(500),
      attested: z.boolean().optional(),
      product: z.unknown().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success)
    return c.json(
      { error: { message: "Complete the review and a short reason." } },
      400,
    );
  const b = input.data;
  const table =
    b.kind === "product"
      ? "products"
      : b.kind === "candidate"
        ? "ingestion_candidates"
        : "submissions";
  const recordKey = b.kind === "product" ? "slug" : "id";
  const row = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE ${recordKey}=?`,
  )
    .bind(b.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: { message: "Record not found." } }, 404);
  if (b.action === "save") {
    if (b.kind !== "candidate")
      return c.json(
        {
          error: {
            message:
              "Draft saving is available for discovered apps. Publish or reject this record when ready.",
          },
        },
        400,
      );
    const draft = JSON.stringify(b.product);
    if (!draft || draft.length > 12000)
      return c.json({ error: { message: "Draft is too large." } }, 400);
    await c.env.DB.prepare(
      "UPDATE ingestion_candidates SET review_draft_json=? WHERE id=?",
    )
      .bind(draft, b.id)
      .run();
  } else if (b.action === "publish") {
    if (!b.attested)
      return c.json(
        {
          error: { message: "Confirm that you checked the official sources." },
        },
        400,
      );
    const timestamp = new Date().toISOString();
    const raw = (b.product ?? {}) as Record<string, unknown>;
    const originalSource =
      b.kind === "product"
        ? await c.env.DB.prepare(
            "SELECT source_type,source_name,source_url,external_id,discovered_at FROM product_sources WHERE product_id=? LIMIT 1",
          )
            .bind(row.id)
            .first()
        : null;
    const previousProduct =
      b.kind === "product"
        ? { slug: String(row.slug), canonical_url: String(row.canonical_url) }
        : await c.env.DB.prepare(
            "SELECT slug,canonical_url FROM products WHERE canonical_url=?",
          )
            .bind(row.canonical_url ?? row.submitted_url)
            .first<{ slug: string; canonical_url: string }>();
    if (previousProduct && raw.slug !== previousProduct.slug)
      return c.json(
        {
          error: {
            message:
              "Keep the existing public URL slug so saved links continue to work.",
          },
        },
        400,
      );
    if (
      previousProduct &&
      raw.canonical_url !== previousProduct.canonical_url
    ) {
      const duplicate = await c.env.DB.prepare(
        "SELECT slug FROM products WHERE canonical_url=? AND slug!=?",
      )
        .bind(raw.canonical_url, previousProduct.slug)
        .first();
      if (duplicate)
        return c.json(
          { error: { message: "That website already has a catalog entry." } },
          409,
        );
    }
    const p = productInput.safeParse({
      ...raw,
      editorial_reviewed: true,
      ...(previousProduct && raw.canonical_url !== previousProduct.canonical_url
        ? { previous_canonical_url: previousProduct.canonical_url }
        : {}),
      first_seen_at: row.first_seen_at ?? row.created_at,
      last_verified_at: timestamp,
      source: originalSource ?? {
        source_type:
          b.kind === "submission"
            ? "submission"
            : row.source_name === "GitHub"
              ? "github"
              : row.source_name === "Hacker News"
                ? "hackernews"
                : "feed",
        source_name:
          row.source_name ??
          (b.kind === "product" ? "Operator review" : "Submissions"),
        source_url: row.source_url ?? row.submitted_url ?? row.canonical_url,
        external_id: row.external_id ?? String(row.id),
        discovered_at: row.first_seen_at ?? row.created_at,
      },
      ...(b.kind === "submission" ? { submission_id: b.id } : {}),
    });
    if (!p.success)
      return c.json({ error: { message: p.error.issues[0].message } }, 400);
    const response = await internal.request(
      "/ingest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: [p.data] }),
      },
      c.env,
    );
    if (!response.ok) return response;
    if (b.kind === "submission")
      await c.env.DB.prepare(
        "UPDATE submissions SET status='published',reviewed_at=? WHERE id=?",
      )
        .bind(timestamp, b.id)
        .run();
    if (b.kind === "candidate")
      await c.env.DB.prepare(
        "UPDATE ingestion_candidates SET status='published',reason=?,updated_at=? WHERE id=?",
      )
        .bind(b.reason, timestamp, b.id)
        .run();
  } else {
    if (b.kind === "product" && b.action !== "reject")
      return c.json(
        {
          error: { message: "Edit and publish this product, or unpublish it." },
        },
        400,
      );
    const action =
      b.kind === "product"
        ? "remove"
        : b.action === "reject"
          ? "reject"
          : b.kind === "submission"
            ? "approve"
            : "retry";
    const response = await internal.request(
      "/moderate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: b.kind,
          id: b.id,
          action,
          reason: b.reason,
        }),
      },
      c.env,
    );
    if (!response.ok) return response;
  }
  await c.env.DB.prepare(
    "INSERT INTO review_audit(kind,record_id,action,reason) VALUES(?,?,?,?)",
  )
    .bind(b.kind, b.id, b.action, b.reason)
    .run();
  return c.json({ status: b.action === "publish" ? "published" : "updated" });
});
export { admin };
