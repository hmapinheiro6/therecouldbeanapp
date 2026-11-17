import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { splitSql } from "../../scripts/sql";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { getProduct } from "../../worker/catalog";
import { app } from "../../worker/index";
import { digest, hmac, type Bindings } from "../../worker/security";
import {
  DAILY_INGESTION_UNITS,
  reserveIngestion,
} from "../../worker/ingestion-budget";
let mf: Miniflare, env: Bindings;
const secret = "test-internal-secret-at-least-32-characters";
async function signed(
  path: string,
  body?: unknown,
  nonce = crypto.randomUUID(),
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const raw = body === undefined ? "" : JSON.stringify(body),
    method = body === undefined ? "GET" : "POST";
  const signature = await hmac(
    secret,
    [method, path, timestamp, nonce, await digest(raw)].join("\n"),
  );
  return new Request("http://localhost" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Signature": signature,
    },
    body: raw || undefined,
  });
}
async function submit(
  name = "Test product",
  url = "https://a-real-product.dev",
  token = "valid-token-" + crypto.randomUUID(),
) {
  return app.request(
    "/api/submit",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.42",
      },
      body: JSON.stringify({
        product_name: name,
        submitted_url: url,
        description: "Useful software for testing the submission flow.",
        turnstile_token: token,
      }),
    },
    env,
  );
}
beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: "test",
          compatibilityDate: "2026-11-15",
          manifest: {
            mainModule: "test.js",
            modulesRoot: process.cwd(),
            modules: {
              "test.js": {
                type: "esm",
                contents: "export default {fetch(){return new Response('ok')}}",
              },
            },
          },
          env: { DB: { type: "d1", id: "test" } },
        },
      },
    ],
  });
  const db = await mf.getD1Database("DB");
  // D1 exec expects one SQL statement per line. Migration contains trigger bodies; use SQLite's complete multi-statement parser via prepare.
  for (const file of [
    ...readdirSync("migrations")
      .sort()
      .map((f) => "migrations/" + f),
    "data/seeds/catalog.sql",
  ]) {
    const sql = readFileSync(file, "utf8");
    const statements = splitSql(sql);
    for (const s of statements) await db.prepare(s).run();
  }
  env = {
    DB: db as D1Database,
    ASSETS: {
      fetch: async () =>
        new Response(
          "<html><head><title>Test</title></head><body></body></html>",
        ),
      connect: () => {
        throw new Error("Not supported in test");
      },
    } as Fetcher,
    SITE_URL: "http://localhost",
    TURNSTILE_SITE_KEY: "test",
    TURNSTILE_HOSTNAME: "localhost",
    INGESTION_ENABLED: "true",
    SUBMISSIONS_ENABLED: "true",
    INTERNAL_SECRET: secret,
    RATE_LIMIT_SALT: "separate-test-rate-limit-salt-32-chars",
    TURNSTILE_SECRET_KEY: "fake-test-secret",
  };
}, 60000);
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  const today = new Date().toISOString();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO d1_usage_observations(day,rows_read,rows_written,observed_at) VALUES(?,0,0,?)",
  )
    .bind(today.slice(0, 10), today)
    .run();
  await env.DB.prepare("DELETE FROM submission_rate_limits").run();
  await env.DB.prepare("DELETE FROM submissions").run();
});
afterEach(() => vi.unstubAllGlobals());
describe("public API", () => {
  it("has no public database read endpoints", async () => {
    for (const path of [
      "/api/search?q=meeting",
      "/api/products/otter",
      "/api/products",
      "/api/stats",
      "/api/categories",
      "/api/config",
      "/api/health",
    ]) {
      const response = await app.request(path, {}, env);
      expect(response.status).toBe(404);
      expect(response.headers.get("X-D1-Rows-Read")).toBe("0");
    }
  });
  it("rejects malicious URLs and XSS submissions before verification", async () => {
    expect((await submit("Bad", "https://127.0.0.1")).status).toBe(400);
    expect((await submit("<script>alert(1)</script>")).status).toBe(400);
  });
  it("rejects oversized bodies", async () => {
    const r = await app.request(
      "/api/submit",
      { method: "POST", body: "x".repeat(140000) },
      env,
    );
    expect(r.status).toBe(413);
  });
  it("fails closed without Turnstile and for invalid tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false })),
    );
    expect((await submit()).status).toBe(400);
  });
  it("checks hostname and action, rejecting cross-site challenges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          hostname: "attacker.example",
          action: "submit",
        }),
      ),
    );
    expect((await submit()).status).toBe(400);
  });
  it("stores a real pending submission and rejects a duplicate token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          hostname: "localhost",
          action: "submit",
        }),
      ),
    );
    const token = "one-use-token";
    const r = await submit("Test one", "https://test-one.dev", token);
    expect(r.status).toBe(202);
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM submissions WHERE submitted_url='https://test-one.dev'",
        ).first()
      )?.status,
    ).toBe("pending");
    expect(
      (await submit("Test two", "https://test-two.dev", token)).status,
    ).toBe(400);
  });
  it("limits successful challenges to five daily attempts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          hostname: "localhost",
          action: "submit",
        }),
      ),
    );
    for (let i = 0; i < 5; i++)
      expect(
        (await submit("Test " + i, "https://test-" + i + ".dev")).status,
      ).toBe(202);
    expect((await submit("Another", "https://another.dev")).status).toBe(429);
  });
  it("returns an existing product without inserting a duplicate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          hostname: "localhost",
          action: "submit",
        }),
      ),
    );
    const r = await submit("Otter", "https://otter.ai");
    expect(((await r.json()) as { status: string }).status).toBe("exists");
  });
});
describe("internal security", () => {
  it("requires a signature", async () => {
    expect((await app.request("/api/internal/pending", {}, env)).status).toBe(
      401,
    );
  });
  it("rejects expired signatures", async () => {
    expect(
      (
        await app.fetch(
          await signed(
            "/api/internal/pending",
            undefined,
            crypto.randomUUID(),
            "1000000000",
          ),
          env,
        )
      ).status,
    ).toBe(401);
  });
  it("prevents signed request replay", async () => {
    const request = await signed("/api/internal/pending");
    expect(
      (
        await app.request(
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
          }),
          {},
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          new Request(request.url, {
            method: request.method,
            headers: request.headers,
          }),
          {},
          env,
        )
      ).status,
    ).toBe(409);
  });
  it("does not accept unsigned body changes", async () => {
    const r = await signed("/api/internal/ingest", { products: [] });
    const changed = new Request(r.url, {
      method: "POST",
      headers: r.headers,
      body: JSON.stringify({ products: [{ name: "forged" }] }),
    });
    expect((await app.fetch(changed, env)).status).toBe(401);
  });
  it("rejects malformed product batches and unknown vocabulary", async () => {
    const r = await app.fetch(
      await signed("/api/internal/ingest", {
        products: [{ name: "incomplete" }],
      }),
      env,
    );
    expect(r.status).toBe(400);
  });
  it("records successful runs and checkpoints atomically", async () => {
    const run = {
      id: crypto.randomUUID(),
      source_name: "test",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      candidates_found: 0,
      records_accepted: 0,
      records_rejected: 0,
      records_pending: 0,
      error_summary: null,
    };
    const r = await app.fetch(
      await signed("/api/internal/ingest", {
        run,
        checkpoints: [{ source_name: "test", cursor_value: "42" }],
      }),
      env,
    );
    expect(r.status).toBe(200);
    expect(
      (
        await env.DB.prepare(
          "SELECT cursor_value FROM ingestion_checkpoints WHERE source_name='test'",
        ).first()
      )?.cursor_value,
    ).toBe("42");
  });
  it("cannot advance a checkpoint without a success record", async () => {
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", {
            checkpoints: [{ source_name: "test", cursor_value: "43" }],
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});

describe("publication lifecycle", () => {
  it("upserts verified products idempotently and synchronizes FTS after removal", async () => {
    const seeds = JSON.parse(readFileSync("data/seeds/catalog.json", "utf8"));
    const product = seeds.find((p: { slug: string }) => p.slug === "otter");
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", { products: [product] }),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", { products: [product] }),
          env,
        )
      ).status,
    ).toBe(200);
    const count = await env.DB.prepare(
      "SELECT count(*) n FROM products WHERE canonical_url=?",
    )
      .bind(product.canonical_url)
      .first();
    expect(count?.n).toBe(1);
    expect(
      (
        await app.fetch(
          await signed("/api/internal/moderate", {
            kind: "product",
            id: "otter",
            action: "remove",
            reason: "Test explicit removal",
          }),
          env,
        )
      ).status,
    ).toBe(200);
    expect((await app.request("/api/products/otter", {}, env)).status).toBe(
      404,
    );
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", { products: [product] }),
          env,
        )
      ).status,
    ).toBe(422);
    await env.DB.prepare("DELETE FROM publication_blocks WHERE canonical_url=?")
      .bind(product.canonical_url)
      .run();
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", { products: [product] }),
          env,
        )
      ).status,
    ).toBe(200);
  });
  it("rejects unknown taxonomy and foreign-site evidence before writes", async () => {
    const product = JSON.parse(
      readFileSync("data/seeds/catalog.json", "utf8"),
    )[0];
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", {
            products: [{ ...product, category_slug: "imaginary-category" }],
          }),
          env,
        )
      ).status,
    ).toBe(400);
    product.capabilities[0].evidence_url = "https://foreign-site.dev/evidence";
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", { products: [product] }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});

describe("private review dashboard", () => {
  const adminKey =
    "isolated-admin-test-key-64-bytes-for-private-review-only-123456789";
  async function login() {
    env.ADMIN_SECRET = adminKey;
    return app.request(
      "/api/admin/login",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: adminKey }),
      },
      env,
    );
  }
  it("requires authentication and rejects cross-origin requests", async () => {
    env.ADMIN_SECRET = adminKey;
    expect((await app.request("/api/admin/queue", {}, env)).status).toBe(401);
    const r = await app.request(
      "/api/admin/login",
      {
        method: "POST",
        headers: {
          Origin: "https://attacker.dev",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: adminKey }),
      },
      env,
    );
    expect(r.status).toBe(403);
  });
  it("uses a private session and revokes it on sign out", async () => {
    const r = await login();
    expect(r.status).toBe(200);
    const cookie = r.headers.get("Set-Cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(adminKey);
    const auth = { Cookie: cookie.split(";")[0], Origin: "http://localhost" };
    expect(
      (await app.request("/api/admin/overview", { headers: auth }, env)).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          "/api/admin/logout",
          { method: "POST", headers: auth },
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (await app.request("/api/admin/queue", { headers: auth }, env)).status,
    ).toBe(401);
  });
  it("publishes a reviewed identity-only listing directly and indexes it", async () => {
    const r = await login();
    const auth = {
      Cookie: r.headers.get("Set-Cookie")!.split(";")[0],
      Origin: "http://localhost",
      "Content-Type": "application/json",
    };
    const stamp = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO ingestion_candidates(id,source_name,source_url,external_id,name,canonical_url,status,attempts,created_at,updated_at) VALUES('admin-review-test','GitHub','https://github.com/example/review','review','Admin Example','https://admin-product.dev','needs_review',1,?,?)",
    )
      .bind(stamp, stamp)
      .run();
    const product = {
      slug: "admin-example-reviewed",
      name: "Admin Example",
      canonical_url: "https://admin-product.dev",
      short_description:
        "An application for testing private editorial publication.",
      category_slug: "desktop-apps",
      verification_scope: "identity",
      identity_evidence_url: "https://admin-product.dev",
      identity_evidence_text: "Admin Example official application",
      capabilities: [],
    };
    const body = {
      kind: "candidate",
      id: "admin-review-test",
      action: "publish",
      reason: "Official website and identity checked.",
      product,
    };
    expect(
      (
        await app.request(
          "/api/admin/review",
          { method: "POST", headers: auth, body: JSON.stringify(body) },
          env,
        )
      ).status,
    ).toBe(400);
    const response = await app.request(
      "/api/admin/review",
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ ...body, attested: true }),
      },
      env,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const p = (await getProduct(env.DB, "admin-example-reviewed"))!;
    expect(p.verification_scope).toBe("identity");
    expect(p.capabilities).toHaveLength(0);
    expect(
      (await app.request("/api/search?q=Admin%20Example", {}, env)).status,
    ).toBe(404);
    expect(
      (
        await env.DB.prepare(
          "SELECT status FROM ingestion_candidates WHERE id='admin-review-test'",
        ).first<{ status: string }>()
      )?.status,
    ).toBe("published");
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM review_audit WHERE record_id='admin-review-test'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(1);
  });
  it("rejects identity claims with evidence on a different website", async () => {
    const value = {
      slug: "identity-example",
      name: "Identity Example",
      canonical_url: "https://actual.dev",
      short_description:
        "An application with an independently checked identity.",
      category_slug: "desktop-apps",
      verification_scope: "identity",
      identity_evidence_url: "https://unrelated.dev",
      identity_evidence_text: "A different source",
      capabilities: [],
      first_seen_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
      source: {
        source_type: "feed",
        source_name: "Homebrew",
        source_url: "https://formulae.brew.sh/cask/example",
        external_id: "example",
        discovered_at: new Date().toISOString(),
      },
    };
    const response = await app.request(
      await signed("/api/internal/ingest", { products: [value] }),
      {},
      env,
    );
    expect(response.status).toBe(400);
  });
});

it("edits and unpublishes the existing catalog while preserving slugs and URL aliases", async () => {
  env.ADMIN_SECRET =
    "isolated-admin-test-key-64-bytes-for-private-review-only-123456789";
  const login = await app.request(
    "/api/admin/login",
    {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: env.ADMIN_SECRET }),
    },
    env,
  );
  const headers = {
    Cookie: login.headers.get("Set-Cookie")!.split(";")[0],
    Origin: "http://localhost",
    "Content-Type": "application/json",
  };
  const draft = await app.request(
    "/api/admin/draft?kind=product&id=admin-example-reviewed",
    { headers },
    env,
  );
  expect(draft.status).toBe(200);
  const { product } = (await draft.json()) as {
    product: Record<string, unknown>;
  };
  const updated = {
    ...product,
    canonical_url: "https://corrected-admin-product.dev",
    identity_evidence_url: "https://corrected-admin-product.dev",
    identity_evidence_text: "Admin Example corrected official website",
  };
  const publish = await app.request(
    "/api/admin/review",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "product",
        id: "admin-example-reviewed",
        action: "publish",
        reason: "Corrected the official website.",
        attested: true,
        product: updated,
      }),
    },
    env,
  );
  expect(publish.status, await publish.clone().text()).toBe(200);
  expect(
    (await getProduct(env.DB, "admin-example-reviewed"))?.canonical_url,
  ).toBe(updated.canonical_url);
  const known = await app.request(
    await signed("/api/internal/known", {
      urls: ["https://admin-product.dev"],
    }),
    {},
    env,
  );
  expect(((await known.json()) as { known: string[] }).known).toContain(
    "https://admin-product.dev",
  );
  const remove = await app.request(
    "/api/admin/review",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "product",
        id: "admin-example-reviewed",
        action: "reject",
        reason: "Remove the isolated test fixture.",
      }),
    },
    env,
  );
  expect(remove.status).toBe(200);
  expect(
    (await app.request("/api/products/admin-example-reviewed", {}, env)).status,
  ).toBe(404);
  const invalid = await app.request(
    "/api/admin/review",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "product",
        id: "admin-example-reviewed",
        action: "publish",
        reason: "Check invalid taxonomy keeps the publication block.",
        attested: true,
        product: { ...updated, category_slug: "not-a-category" },
      }),
    },
    env,
  );
  expect(invalid.status).toBe(400);
  expect(
    await env.DB.prepare(
      "SELECT canonical_url FROM publication_blocks WHERE canonical_url=?",
    )
      .bind(updated.canonical_url)
      .first(),
  ).not.toBeNull();
  const restored = await app.request(
    "/api/admin/review",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "product",
        id: "admin-example-reviewed",
        action: "publish",
        reason: "Restore after a complete editorial review.",
        attested: true,
        product: updated,
      }),
    },
    env,
  );
  expect(restored.status, await restored.clone().text()).toBe(200);
  expect(
    await env.DB.prepare(
      "SELECT canonical_url FROM publication_blocks WHERE canonical_url=?",
    )
      .bind(updated.canonical_url)
      .first(),
  ).toBeNull();
});

it("explains the daily database limit without accepting a login or leaking credentials", async () => {
  const quota = new Error(
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
  );
  const blockedEnv = {
    ...env,
    ADMIN_SECRET: "isolated-quota-test-admin-key-at-least-32-characters",
    DB: {
      prepare() {
        throw quota;
      },
    } as unknown as D1Database,
  };
  const r = await app.request(
    "/api/admin/login",
    {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: blockedEnv.ADMIN_SECRET }),
    },
    blockedEnv,
  );
  expect(r.status).toBe(503);
  expect(r.headers.get("Set-Cookie")).toBeNull();
  const body = (await r.json()) as {
    error: { code: string; reset_at: string; message: string };
  };
  expect(body.error.code).toBe("database_daily_limit");
  expect(body.error.reset_at).toMatch(/T00:00:00.000Z$/);
  expect(body.error.message).toContain("access key has not been checked");
  expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toContain(blockedEnv.ADMIN_SECRET);
  const detail = await app.request(
    "/apps/otter",
    {},
    {
      ...blockedEnv,
      ASSETS: {
        fetch: async (req: Request) =>
          new URL(req.url).pathname === "/apps/otter"
            ? new Response("<h1>Static Otter catalog</h1>")
            : new Response("missing", { status: 404 }),
      } as Fetcher,
    },
  );
  expect(detail.status).toBe(200);
  expect(detail.headers.get("X-Catalog-Mode")).toBeNull();
  expect(await detail.text()).not.toContain("Saved Otter");
});

it("lets signed scheduled maintenance install the read-budget indexes exactly once", async () => {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  ).run();
  for (const name of [
    "product_sources_product",
    "product_aliases_canonical",
    "published_name",
    "published_recent",
    "candidate_canonical",
  ])
    await env.DB.prepare(`DROP INDEX ${name}`).run();
  await env.DB.prepare("DROP TABLE ingestion_daily_budget").run();
  const response = await app.request(
    await signed("/api/internal/maintenance", {}),
    {},
    env,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    (await app.request(await signed("/api/internal/maintenance", {}), {}, env))
      .status,
  ).toBe(200);
  const count = await env.DB.prepare(
    "SELECT count(*) n FROM d1_migrations WHERE name='0010_read_budget_indexes.sql'",
  ).first<{ n: number }>();
  expect(count?.n).toBe(1);
  const indexes = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('product_sources_product','product_aliases_canonical','published_name','published_recent','candidate_canonical')",
  ).all();
  expect(indexes.results).toHaveLength(5);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM d1_migrations WHERE name='0011_ingestion_budget.sql'",
    ).first<{ n: number }>(),
  ).toEqual({ n: 1 });
});

it("shares an atomic ingestion allowance across jobs and resumes in a new UTC day", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM ingestion_daily_budget WHERE day=?")
    .bind(today)
    .run();
  const outcomes = await Promise.all([
    reserveIngestion(env.DB, 12000),
    reserveIngestion(env.DB, 12000),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  const used = await env.DB.prepare(
    "SELECT reserved_units n FROM ingestion_daily_budget WHERE day=?",
  )
    .bind(today)
    .first<{ n: number }>();
  expect(used?.n).toBe(12000);
  expect(
    await reserveIngestion(
      env.DB,
      DAILY_INGESTION_UNITS,
      new Date("2099-01-02T00:00:00Z"),
    ),
  ).toBe(true);
  expect(
    await reserveIngestion(env.DB, 1, new Date("2099-01-02T23:59:59Z")),
  ).toBe(false);
  expect(
    await reserveIngestion(env.DB, 1, new Date("2099-01-03T00:00:00Z")),
  ).toBe(true);
  await env.DB.prepare(
    "UPDATE ingestion_daily_budget SET reserved_units=? WHERE day=?",
  )
    .bind(DAILY_INGESTION_UNITS, today)
    .run();
  const response = await app.request(
    await signed("/api/internal/ingest", {
      run: {
        id: crypto.randomUUID(),
        source_name: "budget-test",
        started_at: new Date().toISOString(),
        completed_at: null,
        status: "running",
        candidates_found: 0,
        records_accepted: 0,
        records_rejected: 0,
        records_pending: 0,
        error_summary: null,
      },
    }),
    {},
    env,
  );
  expect(response.status).toBe(429);
  expect(
    ((await response.json()) as { error: { code: string } }).error.code,
  ).toBe("ingestion_daily_budget");
  expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM ingestion_runs WHERE source_name='budget-test'",
    ).first<{ n: number }>(),
  ).toEqual({ n: 0 });
});

it("publishes a dated identity-only campaign batch once, with provenance and searchable names", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T12:30:00Z"));
  await env.DB.prepare(
    "UPDATE d1_usage_observations SET observed_at='2026-11-17T12:30:00Z' WHERE day='2026-11-17'",
  ).run();
  try {
    const stamp = new Date().toISOString();
    const products = Array.from({ length: 20 }, (_, i) => ({
      slug: `campaign-fixture-${i}`,
      name: `Campaign Fixture ${i}`,
      canonical_url: `https://campaign-fixture-${i}.dev`,
      short_description:
        "Synthetic software for the ingestion regression test.",
      category_slug: "desktop-apps",
      audience: "Test users",
      search_aliases: "",
      first_seen_at: stamp,
      last_verified_at: stamp,
      verification_scope: "identity",
      identity_evidence_url: `https://campaign-fixture-${i}.dev`,
      identity_evidence_text: `Campaign Fixture ${i} official website`,
      capabilities: [],
      source: {
        source_type: "feed",
        source_name: "WinGet manifests (MIT)",
        source_url: `https://github.com/microsoft/winget-pkgs/blob/master/manifests/c/Fixture/${i}/Fixture.locale.en-US.yaml`,
        external_id: `Fixture.${i}`,
        discovered_at: stamp,
      },
    }));
    const response = await app.fetch(
      await signed("/api/internal/ingest", {
        expansion: "2026-11-17",
        products,
      }),
      env,
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      products: number;
      accounting: { rows_written: number };
    };
    expect(data.products).toBe(20);
    expect(data.accounting.rows_written).toBeGreaterThan(0);
    const visible = (await getProduct(env.DB, products[0].slug))!;
    expect(visible.verification_scope).toBe("identity");
    expect(visible.capabilities).toEqual([]);
    expect(visible.sources).toHaveLength(1);
    expect(
      (
        await env.DB.prepare(
          "SELECT count(*) n FROM products WHERE name LIKE 'Campaign %'",
        ).first()
      )?.n,
    ).toBe(20);
    const before = await env.DB.prepare(
      "SELECT reserved_units FROM expansion_daily_budget WHERE day='2026-11-17'",
    ).first();
    const duplicate = await app.fetch(
      await signed("/api/internal/ingest", {
        expansion: "2026-11-17",
        products,
      }),
      env,
    );
    expect(((await duplicate.json()) as { products: number }).products).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT reserved_units FROM expansion_daily_budget WHERE day='2026-11-17'",
      ).first(),
    ).toEqual(before);
    const invented = {
      ...products[0],
      canonical_url: "https://other-fixture.dev",
      editorial_reviewed: true,
    };
    expect(
      (
        await app.fetch(
          await signed("/api/internal/ingest", {
            expansion: "2026-11-17",
            products: [invented],
          }),
          env,
        )
      ).status,
    ).toBe(400);
  } finally {
    vi.useRealTimers();
  }
});

it("campaign reservations stop at their own ceiling and expiry without changing regular ingestion", async () => {
  const { reserveExpansion } = await import("../../worker/expansion");
  const day = "2026-11-17";
  await env.DB.prepare(
    "INSERT OR REPLACE INTO expansion_daily_budget(day,reserved_units) VALUES(?,79990)",
  )
    .bind(day)
    .run();
  expect(await reserveExpansion(env.DB, 1, new Date(day + "T15:00:00Z"))).toBe(
    false,
  );
  expect(
    (
      await env.DB.prepare(
        "SELECT reserved_units FROM expansion_daily_budget WHERE day=?",
      )
        .bind(day)
        .first()
    )?.reserved_units,
  ).toBe(79990);
  expect(
    await reserveExpansion(env.DB, 1, new Date("2026-11-18T00:00:00Z")),
  ).toBe(false);
  expect(await reserveExpansion(env.DB, 21, new Date(day + "T15:00:00Z"))).toBe(
    false,
  );
});

it("exports published recovery records by advancing id with provenance and aliases", async () => {
  const plan = await env.DB.prepare(
    "EXPLAIN QUERY PLAN SELECT p.id FROM products p NOT INDEXED JOIN categories c ON c.id=p.category_id WHERE p.status='published' AND p.id>0 ORDER BY p.id LIMIT 50",
  ).all<{ detail: string }>();
  expect(
    plan.results.some((r) => r.detail.includes("INTEGER PRIMARY KEY")),
  ).toBe(true);
  expect(plan.results.some((r) => r.detail.includes("TEMP B-TREE"))).toBe(
    false,
  );
  const first = await app.request(
    await signed("/api/internal/snapshot?after=0"),
    {},
    env,
  );
  expect(first.status).toBe(200);
  const page = (await first.json()) as {
    products: {
      id: number;
      canonical_url: string;
      sources: unknown[];
      url_aliases: string[];
    }[];
    next_after: number | null;
  };
  expect(page.products.length).toBeGreaterThan(0);
  expect(
    page.products.every(
      (p) => p.sources.length > 0 && Array.isArray(p.url_aliases),
    ),
  ).toBe(true);
  const last = page.products[page.products.length - 1].id;
  const following = await app.request(
    await signed("/api/internal/snapshot?after=" + last),
    {},
    env,
  );
  const next = (await following.json()) as typeof page;
  expect(next.products.every((p) => p.id > last)).toBe(true);
  const bad = await app.request(
    await signed("/api/internal/snapshot?after=-1"),
    {},
    env,
  );
  expect(bad.status).toBe(400);
});

it("keeps collector status and URL batches within read budgets at 5000 extra products", async () => {
  const stamp = new Date().toISOString();
  await env.DB.prepare(
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5000)
    INSERT INTO products(slug,name,canonical_url,normalized_domain,short_description,category_id,status,first_seen_at,last_verified_at,verification_scope,identity_evidence_url,identity_evidence_text)
    SELECT 'cost-fixture-'||n,'Cost fixture '||n,'https://cost-fixture.dev/'||n,'cost-fixture.dev','An isolated synthetic performance test application.',1,'published',?,?,'identity','https://cost-fixture.dev','Official fixture identity checked for the isolated cost regression.' FROM seq`,
  )
    .bind(stamp, stamp)
    .run();
  try {
    const status = await app.request(
      await signed("/api/internal/expansion-status"),
      {},
      env,
    );
    expect(status.status).toBe(200);
    expect(Number(status.headers.get("X-D1-Rows-Read"))).toBeLessThan(50);
    const known = await app.request(
      await signed("/api/internal/known", {
        urls: Array.from(
          { length: 30 },
          (_, i) => "https://cost-fixture.dev/" + (i + 1),
        ),
      }),
      {},
      env,
    );
    expect(known.status).toBe(200);
    expect(Number(known.headers.get("X-D1-Rows-Read"))).toBeLessThan(300);
    const page = await app.request(
      await signed("/api/internal/identity-index?after=0"),
      {},
      env,
    );
    expect(page.status).toBe(200);
    expect(Number(page.headers.get("X-D1-Rows-Read"))).toBeLessThan(1100);
  } finally {
    await env.DB.prepare(
      "DELETE FROM products WHERE slug LIKE 'cost-fixture-%'",
    ).run();
  }
});
it("serializes removal against deployment and refuses an outdated catalog revision", async () => {
  const revision = (await env.DB.prepare(
    "SELECT value FROM catalog_counters WHERE key='revision'",
  ).first<{ value: number }>())!.value;
  const first = await app.request(
    await signed("/api/internal/publication-lease", {
      action: "acquire",
      revision,
    }),
    {},
    env,
  );
  expect(first.status).toBe(200);
  const { token } = (await first.json()) as { token: string };
  try {
    const second = await app.request(
      await signed("/api/internal/publication-lease", {
        action: "acquire",
        revision,
      }),
      {},
      env,
    );
    expect(second.status).toBe(409);
    const p = await env.DB.prepare(
      "SELECT slug,status FROM products WHERE status='published' LIMIT 1",
    ).first<{ slug: string; status: string }>();
    const remove = await app.request(
      await signed("/api/internal/moderate", {
        kind: "product",
        id: p!.slug,
        action: "remove",
        reason: "Isolated lock regression",
      }),
      {},
      env,
    );
    expect(remove.status).toBe(409);
    expect(
      (
        await env.DB.prepare("SELECT status FROM products WHERE slug=?")
          .bind(p!.slug)
          .first<{ status: string }>()
      )?.status,
    ).toBe(p!.status);
  } finally {
    await app.request(
      await signed("/api/internal/publication-lease", {
        action: "release",
        token,
      }),
      {},
      env,
    );
  }
  await env.DB.prepare(
    "UPDATE catalog_counters SET value=value+1 WHERE key='revision'",
  ).run();
  const stale = await app.request(
    await signed("/api/internal/publication-lease", {
      action: "acquire",
      revision,
    }),
    {},
    env,
  );
  expect(stale.status).toBe(409);
});

it("dispatches a static release without requiring an inherited ExecutionContext", async () => {
  const stamp = new Date().toISOString(),
    url = "https://dispatch-fixture.dev";
  const remote = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", remote);
  const product = {
    slug: "dispatch-fixture",
    name: "Dispatch Fixture",
    canonical_url: url,
    short_description:
      "An isolated fixture for testing autonomous static publication.",
    category_slug: "desktop-apps",
    audience: "Developers",
    first_seen_at: stamp,
    announced_at: null,
    last_verified_at: stamp,
    verification_scope: "identity",
    identity_evidence_url: url,
    identity_evidence_text:
      "Dispatch Fixture is the official application website.",
    capabilities: [],
    source: {
      source_type: "feed",
      source_name: "Isolated test",
      source_url: "https://source-fixture.dev/catalog",
      external_id: "dispatch-fixture",
      discovered_at: stamp,
    },
  };
  try {
    const response = await app.request(
      await signed("/api/internal/ingest", { products: [product] }),
      {},
      {
        ...env,
        OPERATOR_PUBLICATION: true,
        WATCHDOG_GITHUB_TOKEN: "isolated-repository-token",
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      ((await response.json()) as { publication: string }).publication,
    ).toBe("queued");
    expect(remote).toHaveBeenCalledTimes(1);
  } finally {
    await env.DB.prepare("DELETE FROM products WHERE canonical_url=?")
      .bind(url)
      .run();
  }
});
it("returns 410 for a configured removed path without accessing D1", async () => {
  const database = {
    prepare: vi.fn(() => {
      throw new Error("D1 unavailable");
    }),
  } as unknown as D1Database;
  const response = await app.request(
    "/apps/removed-fixture",
    {},
    { ...env, DB: database, STATIC_BLOCKED_SLUGS: '["removed-fixture"]' },
  );
  expect(response.status).toBe(410);
  expect(database.prepare).not.toHaveBeenCalled();
});
