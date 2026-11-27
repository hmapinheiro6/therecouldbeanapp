import { staticOperations } from "./operations-schema";
import { currentBudget } from "./budget";
import { acquirePublication, releasePublication } from "./publication-lease";
import { requestStaticPublish } from "./operations";
import { Hono } from "hono";
import { ingestionUnits, reserveIngestion } from "./ingestion-budget";
import {
  expansionBatch,
  reserveExpansion,
  expansionStatements,
  EXPANSION_TARGET,
} from "./expansion";
import { quotaResponse } from "./availability";
import type { AppEnv } from "./security";
import { ingestSchema, moderationSchema } from "./validation";
import { hydrate, PRODUCT_SELECT, type ProductRow } from "./catalog";
const internal = new Hono<AppEnv>();
internal.get("/budget", async (c) => c.json(await currentBudget(c.env)));
internal.use("/ingest", async (c, next) => {
  const budget = await currentBudget(c.env);
  if (!c.env.OPERATOR_PUBLICATION && !budget.allowed)
    return c.json(
      {
        error: {
          code: "ingestion_daily_budget",
          message:
            "Bulk jobs are paused to preserve the daily database allowance.",
          reset_at: budget.reset_at,
          reason: budget.reason,
        },
      },
      429,
    );
  await next();
});
internal.post("/publication-lease", async (c) => {
  const body = (await c.req.json()) as {
    action?: string;
    revision?: number;
    token?: string;
  };
  if (
    body.action === "release" &&
    typeof body.token === "string" &&
    /^[a-f0-9-]{36}$/.test(body.token)
  ) {
    await releasePublication(c.env.DB, body.token);
    return c.json({ released: true });
  }
  if (
    body.action !== "acquire" ||
    !Number.isSafeInteger(body.revision) ||
    body.revision! < 0
  )
    return c.json(
      { error: { message: "Invalid publication lease request." } },
      400,
    );
  const token = await acquirePublication(c.env.DB, body.revision);
  return token
    ? c.json({ token })
    : c.json(
        {
          error: {
            code: "publication_changed",
            message:
              "The catalog changed or a release is active. Retry with a fresh export.",
          },
        },
        409,
      );
});
internal.post("/maintenance", async (c) => {
  // Existing signed cloud jobs apply this tracked, idempotent migration after quota reset.
  const name = "0010_read_budget_indexes.sql";
  const exists = await c.env.DB.prepare(
    "SELECT name FROM d1_migrations WHERE name=?",
  )
    .bind(name)
    .first();
  if (!exists) {
    const statements = [
      "CREATE INDEX IF NOT EXISTS product_sources_product ON product_sources(product_id)",
      "CREATE INDEX IF NOT EXISTS product_aliases_canonical ON product_url_aliases(canonical_url)",
      "CREATE INDEX IF NOT EXISTS published_name ON products(status,name,id)",
      "CREATE INDEX IF NOT EXISTS published_recent ON products(status,first_seen_at DESC,id DESC)",
      "CREATE INDEX IF NOT EXISTS candidate_canonical ON ingestion_candidates(canonical_url,status,next_retry_at)",
    ];
    await c.env.DB.batch([
      ...statements.map((sql) => c.env.DB.prepare(sql)),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)",
      ).bind(name),
    ]);
  }
  const budgetName = "0011_ingestion_budget.sql";
  const budgetExists = await c.env.DB.prepare(
    "SELECT name FROM d1_migrations WHERE name=?",
  )
    .bind(budgetName)
    .first();
  if (!budgetExists)
    await c.env.DB.batch([
      c.env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS ingestion_daily_budget(day TEXT PRIMARY KEY,reserved_units INTEGER NOT NULL CHECK(reserved_units>=0))",
      ),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)",
      ).bind(budgetName),
    ]);
  const expansionMigration = "0012_expansion_budget.sql";
  if (
    !(await c.env.DB.prepare("SELECT name FROM d1_migrations WHERE name=?")
      .bind(expansionMigration)
      .first())
  ) {
    await c.env.DB.batch([
      ...expansionStatements.map((sql) => c.env.DB.prepare(sql)),
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)",
      ).bind(expansionMigration),
    ]);
  }
  const staticMigration = "0013_static_operations.sql";
  if (
    !(await c.env.DB.prepare("SELECT name FROM d1_migrations WHERE name=?")
      .bind(staticMigration)
      .first())
  ) {
    const legacy = await c.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='product_fts'",
    ).first();
    await c.env.DB.batch(
      staticOperations
        .filter((sql) => legacy || !/product_update/.test(sql))
        .map((sql) => c.env.DB.prepare(sql)),
    );
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)",
    )
      .bind(staticMigration)
      .run();
  }
  return c.json({ status: "ready" });
});
internal.get("/expansion-status", async (c) => {
  const rows = await c.env.DB.batch<Record<string, number>>([
    c.env.DB.prepare(
      "SELECT value published FROM catalog_counters WHERE key='published'",
    ),
    c.env.DB.prepare(
      "SELECT reserved_units,rows_written,rows_read FROM expansion_daily_budget WHERE day=?",
    ).bind(new Date().toISOString().slice(0, 10)),
  ]);
  return c.json({
    published: rows[0].results[0]?.published ?? 0,
    budget: rows[1].results[0] ?? null,
    target: EXPANSION_TARGET,
  });
});
internal.get("/pending", async (c) => {
  const after = c.req.query("after") ?? "";
  if (after.length > 100)
    return c.json(
      { error: { code: "invalid_cursor", message: "Invalid cursor." } },
      400,
    );
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT id,product_name,submitted_url,description,category_hint,contact_email,status,moderation_reason,created_at FROM submissions WHERE status IN ('pending','approved','needs_review') AND id>? ORDER BY id LIMIT 25",
    ).bind(after),
    c.env.DB.prepare(
      "SELECT * FROM ingestion_candidates WHERE status IN ('pending_verification','needs_review') AND attempts<5 AND (next_retry_at IS NULL OR next_retry_at<=?) AND id>? ORDER BY id LIMIT 25",
    ).bind(new Date().toISOString(), after),
    c.env.DB.prepare("SELECT * FROM ingestion_checkpoints"),
    c.env.DB.prepare(
      "SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 10",
    ),
  ]);
  return c.json({
    submissions: results[0].results,
    candidates: results[1].results,
    checkpoints: results[2].results,
    runs: results[3].results,
  });
});
internal.post("/known", async (c) => {
  const b = (await c.req.json()) as { urls?: unknown };
  if (
    !Array.isArray(b.urls) ||
    b.urls.length > 30 ||
    b.urls.some((u) => typeof u !== "string" || u.length > 2000)
  )
    return c.json({ error: { message: "Invalid URL batch." } }, 400);
  if (!b.urls.length) return c.json({ known: [] });
  const q = b.urls.map(() => "?").join(",");
  const results = await c.env.DB.batch<{ canonical_url: string }>([
    c.env.DB.prepare(
      `SELECT canonical_url FROM products INDEXED BY sqlite_autoindex_products_2 WHERE status='published' AND canonical_url IN (${q}) UNION SELECT canonical_url FROM publication_blocks WHERE canonical_url IN (${q}) UNION SELECT canonical_url FROM ingestion_candidates WHERE (status IN ('published','needs_review','rejected') OR (status='pending_verification' AND next_retry_at>strftime('%Y-%m-%dT%H:%M:%SZ','now'))) AND canonical_url IN (${q})`,
    ).bind(...b.urls, ...b.urls, ...b.urls),
    c.env.DB.prepare(
      `SELECT alias canonical_url FROM product_url_aliases WHERE alias IN (${q})`,
    ).bind(...b.urls),
  ]);
  return c.json({
    known: results.flatMap((r) => r.results.map((row) => row.canonical_url)),
  });
});
internal.get("/identity-index", async (c) => {
  const after = Number(c.req.query("after") ?? 0);
  if (!Number.isSafeInteger(after) || after < 0)
    return c.json(
      {
        error: { code: "invalid_cursor", message: "Invalid identity cursor." },
      },
      400,
    );
  const rows = await c.env.DB.prepare(
    "SELECT id,slug,name,canonical_url FROM products NOT INDEXED WHERE status='published' AND id>? ORDER BY id LIMIT 500",
  )
    .bind(after)
    .all();
  return c.json({
    products: rows.results,
    next_after:
      rows.results.length === 500
        ? (rows.results.at(-1) as { id: number }).id
        : null,
  });
});
internal.get("/snapshot", async (c) => {
  const after = c.req.query("after");
  const offset = Number(after ?? c.req.query("offset") ?? 0);
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > (after === undefined ? 12000 : Number.MAX_SAFE_INTEGER)
  )
    return c.json(
      { error: { code: "invalid_page", message: "Invalid snapshot page." } },
      400,
    );
  const r = await c.env.DB.prepare(
    `${PRODUCT_SELECT},0 bm25 FROM products p NOT INDEXED JOIN categories c ON c.id=p.category_id WHERE p.status='published' ${after === undefined ? "" : "AND p.id>?"} ORDER BY p.id LIMIT 50 ${after === undefined ? "OFFSET ?" : ""}`,
  )
    .bind(offset)
    .all<ProductRow>();
  const products = await hydrate(c.env.DB, r.results);
  const ids = products.map((p) => p.id);
  const sources = ids.length
    ? await c.env.DB.prepare(
        `SELECT product_id,source_type,source_name,source_url,external_id,discovered_at FROM product_sources WHERE product_id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(...ids)
        .all<{ product_id: number }>()
    : { results: [] };
  const aliases = ids.length
    ? await c.env.DB.prepare(
        `SELECT alias,canonical_url FROM product_url_aliases WHERE canonical_url IN (${products.map(() => "?").join(",")})`,
      )
        .bind(...products.map((p) => p.canonical_url))
        .all<{ alias: string; canonical_url: string }>()
    : { results: [] };
  return c.json({
    products: products.map((p) => ({
      ...p,
      sources: sources.results.filter((s) => s.product_id === p.id),
      url_aliases: aliases.results
        .filter((a) => a.canonical_url === p.canonical_url)
        .map((a) => a.alias),
    })),
    offset,
    next_offset: products.length === 50 ? offset + 50 : null,
    next_after:
      products.length === 50 ? products[products.length - 1].id : null,
  });
});
internal.post("/ingest", async (c) => {
  if (c.env.INGESTION_ENABLED !== "true")
    return c.json(
      {
        error: {
          code: "ingestion_disabled",
          message: "Ingestion is disabled.",
        },
      },
      503,
    );
  let data;
  try {
    data = ingestSchema.safeParse(await c.req.json());
  } catch {
    return c.json(
      { error: { code: "invalid_json", message: "Invalid JSON." } },
      400,
    );
  }
  if (!data.success)
    return c.json(
      {
        error: { code: "invalid_batch", message: data.error.issues[0].message },
      },
      400,
    );
  const b = data.data;
  const db = c.env.DB;
  const ingestionMoment = new Date();
  if (b.expansion && !expansionBatch(b))
    return c.json(
      {
        error: {
          code: "invalid_expansion",
          message:
            "Only source-attributed, identity-only products are accepted by catalog expansion.",
        },
      },
      400,
    );
  let publishedBefore = 0;
  if (b.expansion) {
    const count = await db
      .prepare("SELECT value n FROM catalog_counters WHERE key='published'")
      .first<{ n: number }>();
    publishedBefore = count?.n ?? 0;
    if (publishedBefore >= EXPANSION_TARGET)
      return c.json({ status: "target_reached", products: 0, candidates: 0 });
  }
  const existingCampaign = b.expansion
    ? new Set(
        (
          await db
            .prepare(
              `SELECT canonical_url FROM products WHERE canonical_url IN (${b.products.map(() => "?").join(",")}) UNION SELECT alias canonical_url FROM product_url_aliases WHERE alias IN (${b.products.map(() => "?").join(",")})`,
            )
            .bind(
              ...b.products.map((p) => p.canonical_url),
              ...b.products.map((p) => p.canonical_url),
            )
            .all<{ canonical_url: string }>()
        ).results.map((r) => r.canonical_url),
      )
    : new Set<string>();
  let acceptedProducts = 0;
  const statements: D1PreparedStatement[] = [];
  // Validate all foreign vocabulary before the atomic write. Never silently omit claims.
  const [categories, capabilities] = await db.batch<{ slug: string }>([
    db.prepare("SELECT slug FROM categories"),
    db.prepare("SELECT slug FROM capabilities"),
  ]);
  const categorySet = new Set(categories.results.map((r) => r.slug)),
    capabilitySet = new Set(capabilities.results.map((r) => r.slug));
  if (
    b.products.some(
      (p) =>
        !categorySet.has(p.category_slug) ||
        p.capabilities.some((k) => !capabilitySet.has(k.slug)),
    )
  )
    return c.json(
      {
        error: {
          code: "unknown_taxonomy",
          message: "Unknown category or capability.",
        },
      },
      400,
    );
  const automaticProducts = b.products.filter((p) => !p.editorial_reviewed);
  if (automaticProducts.length) {
    const blocked = await db
      .prepare(
        `SELECT canonical_url FROM publication_blocks WHERE canonical_url IN (${automaticProducts.map(() => "?").join(",")})`,
      )
      .bind(...automaticProducts.map((p) => p.canonical_url))
      .all();
    if (blocked.results.length)
      return c.json(
        {
          error: {
            code: "publication_blocked",
            message:
              "An operator removed this product; manual review is required.",
          },
        },
        422,
      );
  }
  const protectedUrls = b.products.length
    ? new Set(
        (
          await db
            .prepare(
              `SELECT canonical_url FROM products WHERE status='published' AND verification_scope='capabilities' AND canonical_url IN (${b.products.map(() => "?").join(",")})`,
            )
            .bind(...b.products.map((p) => p.canonical_url))
            .all<{ canonical_url: string }>()
        ).results.map((r) => r.canonical_url),
      )
    : new Set<string>();
  for (const p of b.products) {
    if (existingCampaign.has(p.canonical_url)) continue;
    if (b.expansion) {
      if (publishedBefore + acceptedProducts >= EXPANSION_TARGET) break;
      existingCampaign.add(p.canonical_url);
    }
    if (
      p.verification_scope === "identity" &&
      !p.editorial_reviewed &&
      protectedUrls.has(p.canonical_url)
    )
      continue;
    acceptedProducts++;
    const domain = new URL(p.canonical_url).hostname;
    if (p.editorial_reviewed)
      statements.push(
        db
          .prepare("DELETE FROM publication_blocks WHERE canonical_url=?")
          .bind(p.canonical_url),
      );
    if (
      p.previous_canonical_url &&
      p.previous_canonical_url !== p.canonical_url
    ) {
      statements.push(
        db
          .prepare("DELETE FROM product_url_aliases WHERE alias=?")
          .bind(p.canonical_url),
      );
      statements.push(
        db
          .prepare(
            "UPDATE product_url_aliases SET canonical_url=? WHERE canonical_url=?",
          )
          .bind(p.canonical_url, p.previous_canonical_url),
      );
      statements.push(
        db
          .prepare(
            "INSERT OR REPLACE INTO product_url_aliases(alias,canonical_url) VALUES(?,?)",
          )
          .bind(p.previous_canonical_url, p.canonical_url),
      );
      statements.push(
        db
          .prepare(
            "UPDATE products SET canonical_url=?,normalized_domain=? WHERE canonical_url=? AND slug=?",
          )
          .bind(p.canonical_url, domain, p.previous_canonical_url, p.slug),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO products(slug,name,canonical_url,normalized_domain,short_description,category_id,audience,search_aliases,status,first_seen_at,announced_at,last_verified_at,verification_scope,identity_evidence_url,identity_evidence_text) VALUES(?,?,?,?,?,(SELECT id FROM categories WHERE slug=?),?,?,'published',?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET name=excluded.name,short_description=excluded.short_description,category_id=excluded.category_id,audience=excluded.audience,search_aliases=excluded.search_aliases,last_verified_at=excluded.last_verified_at,verification_scope=excluded.verification_scope,identity_evidence_url=excluded.identity_evidence_url,identity_evidence_text=excluded.identity_evidence_text,status='published',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
        .bind(
          p.slug,
          p.name,
          p.canonical_url,
          domain,
          p.short_description,
          p.category_slug,
          p.audience,
          p.search_aliases,
          p.first_seen_at,
          p.announced_at,
          p.last_verified_at,
          p.verification_scope,
          p.identity_evidence_url ?? null,
          p.identity_evidence_text ?? null,
        ),
    );
    if (!b.expansion) {
      statements.push(
        db
          .prepare(
            "DELETE FROM product_capabilities WHERE product_id=(SELECT id FROM products WHERE canonical_url=?)",
          )
          .bind(p.canonical_url),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO product_capabilities(product_id,capability_id,evidence_url,evidence_text,confidence_class,verified_at) SELECT (SELECT id FROM products WHERE canonical_url=?),k.id,json_extract(j.value,'$.evidence_url'),json_extract(j.value,'$.evidence_text'),'verified',json_extract(j.value,'$.verified_at') FROM json_each(?) j JOIN capabilities k ON k.slug=json_extract(j.value,'$.slug')`,
          )
          .bind(p.canonical_url, JSON.stringify(p.capabilities)),
      );
    }
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO product_sources(product_id,source_type,source_name,source_url,external_id,discovered_at) VALUES((SELECT id FROM products WHERE canonical_url=?),?,?,?,?,?)",
        )
        .bind(
          p.canonical_url,
          p.source.source_type,
          p.source.source_name,
          p.source.source_url,
          p.source.external_id,
          p.source.discovered_at,
        ),
    );
    if (p.submission_id)
      statements.push(
        db
          .prepare(
            "UPDATE submissions SET status='published',reviewed_at=? WHERE id=? AND submitted_url=? AND status!='rejected'",
          )
          .bind(new Date().toISOString(), p.submission_id, p.canonical_url),
      );
  }
  for (const a of b.candidates) {
    statements.push(
      db
        .prepare(
          `INSERT INTO ingestion_candidates(id,source_name,source_url,external_id,name,canonical_url,status,reason,attempts,next_retry_at,submission_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_name,external_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,attempts=excluded.attempts,next_retry_at=excluded.next_retry_at,updated_at=excluded.updated_at`,
        )
        .bind(
          a.id,
          a.source_name,
          a.source_url,
          a.external_id,
          a.name,
          a.canonical_url,
          a.status,
          a.reason,
          a.attempts,
          a.next_retry_at,
          a.submission_id ?? null,
          a.created_at,
          a.updated_at,
        ),
    );
  }
  for (const a of b.candidates) {
    if (a.review_draft_json)
      statements.push(
        db
          .prepare(
            "UPDATE ingestion_candidates SET review_draft_json=? WHERE id=?",
          )
          .bind(a.review_draft_json, a.id),
      );
  }
  for (const a of b.candidates) {
    if (
      a.submission_id &&
      ["pending_verification", "needs_review", "rejected"].includes(a.status)
    )
      statements.push(
        db
          .prepare(
            "UPDATE submissions SET status=?,moderation_reason=?,reviewed_at=? WHERE id=? AND status!='rejected'",
          )
          .bind(
            a.status === "rejected" ? "rejected" : "needs_review",
            a.reason,
            new Date().toISOString(),
            a.submission_id,
          ),
      );
  }
  if (b.run) {
    const r = b.run;
    statements.push(
      db
        .prepare(
          `INSERT INTO ingestion_runs(id,source_name,started_at,completed_at,status,candidates_found,records_accepted,records_rejected,records_pending,error_summary) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,status=excluded.status,candidates_found=excluded.candidates_found,records_accepted=excluded.records_accepted,records_rejected=excluded.records_rejected,records_pending=excluded.records_pending,error_summary=excluded.error_summary`,
        )
        .bind(
          r.id,
          r.source_name,
          r.started_at,
          r.completed_at,
          r.status,
          r.candidates_found,
          r.records_accepted,
          r.records_rejected,
          r.records_pending,
          r.error_summary,
        ),
    );
  }
  for (const p of b.checkpoints)
    statements.push(
      db
        .prepare(
          "INSERT INTO ingestion_checkpoints(source_name,cursor_value,last_successful_run_at) VALUES(?,?,?) ON CONFLICT(source_name) DO UPDATE SET cursor_value=excluded.cursor_value,last_successful_run_at=excluded.last_successful_run_at",
        )
        .bind(p.source_name, p.cursor_value, new Date().toISOString()),
    );
  if (b.run?.completed_at) {
    statements.push(
      db
        .prepare("DELETE FROM admin_sessions WHERE expires_at<?")
        .bind(Math.floor(Date.now() / 1000)),
    );
    statements.push(
      db
        .prepare("DELETE FROM admin_login_limits WHERE window<?")
        .bind(Math.floor(Date.now() / 900000) - 2),
    );
    statements.push(
      db
        .prepare("DELETE FROM request_nonces WHERE expires_at<?")
        .bind(Math.floor(Date.now() / 1000)),
    );
    statements.push(
      db.prepare(
        "DELETE FROM submission_rate_limits WHERE date_bucket<date('now','-2 days')",
      ),
    );
    statements.push(
      db.prepare(
        "DELETE FROM submissions WHERE status IN ('rejected','published') AND created_at<datetime('now','-30 days') AND id NOT IN (SELECT submission_id FROM ingestion_candidates WHERE submission_id IS NOT NULL)",
      ),
    );
    statements.push(
      db.prepare(
        "UPDATE submissions SET contact_email=NULL WHERE created_at<datetime('now','-30 days')",
      ),
    );
  }
  if (statements.length > 45)
    return c.json(
      {
        error: {
          code: "batch_too_large",
          message: "Reduce the ingestion batch.",
        },
      },
      400,
    );
  if (b.expansion && !acceptedProducts)
    return c.json({ status: "accepted", products: 0, candidates: 0 });
  if (
    !c.env.OPERATOR_PUBLICATION &&
    !(b.expansion
      ? await reserveExpansion(
          db,
          acceptedProducts,
          ingestionMoment,
          b.expansion,
        )
      : await reserveIngestion(db, ingestionUnits(b)))
  ) {
    const { error, retry } = quotaResponse();
    c.header("Retry-After", String(retry));
    return c.json(
      {
        error: {
          code: "ingestion_daily_budget",
          message:
            "Automatic imports have reached this project’s daily safety budget. Resume after 00:00 UTC; browsing and moderation remain available when D1 is healthy.",
          reset_at: error.reset_at,
        },
      },
      429,
    );
  }
  const results = statements.length ? await db.batch(statements) : [];
  const accounting = {
    rows_written: results.reduce((n, r) => n + (r.meta.rows_written ?? 0), 0),
    rows_read: results.reduce((n, r) => n + (r.meta.rows_read ?? 0), 0),
  };
  if (b.expansion)
    await db
      .prepare(
        "UPDATE expansion_daily_budget SET rows_written=rows_written+?,rows_read=rows_read+? WHERE day=?",
      )
      .bind(
        accounting.rows_written,
        accounting.rows_read,
        ingestionMoment.toISOString().slice(0, 10),
      )
      .run();
  // A bulk run publishes through its workflow_run hook once its checkpoint is sealed.
  // Rebuilding after each twenty-product batch causes redundant releases and revision races.
  const publication =
    acceptedProducts > 0
      ? b.expansion
        ? "after_hosted_run"
        : await requestStaticPublish(c.env)
      : "unchanged";
  return c.json({
    status: "accepted",
    publication,
    accounting,
    catalog_total: b.expansion ? publishedBefore + acceptedProducts : undefined,
    products: acceptedProducts,
    candidates: b.candidates.length,
  });
});
internal.post("/moderate", async (c) => {
  let parsed;
  try {
    parsed = moderationSchema.safeParse(await c.req.json());
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
          code: "invalid_moderation",
          message: "Invalid moderation request.",
        },
      },
      400,
    );
  const { kind, id, action, reason } = parsed.data;
  let statement: D1PreparedStatement;
  if (kind === "product" && action === "remove") {
    const p = await c.env.DB.prepare(
      "SELECT canonical_url FROM products WHERE slug=?",
    )
      .bind(id)
      .first<{ canonical_url: string }>();
    if (!p)
      return c.json(
        { error: { code: "not_found", message: "Record not found." } },
        404,
      );
    const lease = await acquirePublication(c.env.DB);
    if (!lease)
      return c.json(
        {
          error: {
            code: "publication_busy",
            message:
              "A public release is deploying. Retry this removal shortly; the listing has not changed.",
          },
        },
        409,
      );
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE products SET status='needs_review',updated_at=? WHERE slug=?",
        ).bind(new Date().toISOString(), id),
        c.env.DB.prepare(
          "INSERT INTO publication_blocks(canonical_url,reason,created_at) VALUES(?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET reason=excluded.reason",
        ).bind(p.canonical_url, reason, new Date().toISOString()),
      ]);
      // The database is authoritative. Dispatch before reporting the public removal as complete.
      const publication = await requestStaticPublish(c.env, id);
      const immediate = publication === "queued" ? "queued" : "not_active";
      return c.json({ status: "removed", publication, immediate });
    } finally {
      await releasePublication(c.env.DB, lease);
    }
  }
  if (kind === "submission" && ["approve", "reject", "retry"].includes(action))
    statement = c.env.DB.prepare(
      "UPDATE submissions SET status=?,moderation_reason=?,reviewed_at=? WHERE id=?",
    ).bind(
      action === "reject" ? "rejected" : "approved",
      reason,
      new Date().toISOString(),
      id,
    );
  else if (kind === "product" && action === "remove")
    statement = c.env.DB.prepare(
      "UPDATE products SET status='needs_review',updated_at=? WHERE slug=?",
    ).bind(new Date().toISOString(), id);
  else if (kind === "candidate" && ["retry", "reject"].includes(action))
    statement = c.env.DB.prepare(
      "UPDATE ingestion_candidates SET status=?,reason=?,attempts=0,next_retry_at=NULL,updated_at=? WHERE id=?",
    ).bind(
      action === "reject" ? "rejected" : "pending_verification",
      reason,
      new Date().toISOString(),
      id,
    );
  else
    return c.json(
      {
        error: {
          code: "invalid_action",
          message: "This action is not supported for that record.",
        },
      },
      400,
    );
  const result = await statement.run();
  return result.meta.changes
    ? c.json({ status: "updated" })
    : c.json(
        { error: { code: "not_found", message: "Record not found." } },
        404,
      );
});
export { internal };
