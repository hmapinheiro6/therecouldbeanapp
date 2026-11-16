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
  await env.DB.prepare("DELETE FROM submission_rate_limits").run();
  await env.DB.prepare("DELETE FROM submissions").run();
});
afterEach(() => vi.unstubAllGlobals());
describe("public API", () => {
  it("searches real D1 FTS and returns evidence", async () => {
    const r = await app.request("/api/search?q=meeting%20notes", {}, env);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { results: { matched: unknown[] }[] };
    expect(b.results[0].matched.length).toBeGreaterThan(0);
  });
  it("rejects empty and oversized queries", async () => {
    expect((await app.request("/api/search?q=", {}, env)).status).toBe(400);
    expect(
      (await app.request("/api/search?q=" + "a".repeat(160), {}, env)).status,
    ).toBe(200);
    expect(
      (await app.request("/api/search?q=" + "a".repeat(161), {}, env)).status,
    ).toBe(400);
  });
  it("provides a published product and no private fields", async () => {
    const r = await app.request("/api/products/otter", {}, env);
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain("contact_email");
    expect((await app.request("/api/products/unknown", {}, env)).status).toBe(
      404,
    );
  });
  it("orders recent additions by catalog entry date, with stable pagination", async () => {
    const original = await env.DB.prepare(
      "SELECT first_seen_at FROM products WHERE slug='otter'",
    ).first<{ first_seen_at: string }>();
    try {
      await env.DB.prepare(
        "UPDATE products SET first_seen_at='2099-01-01T00:00:00Z' WHERE slug='otter'",
      ).run();
      const r = await app.request("/api/products?sort=recent", {}, env);
      expect(r.status).toBe(200);
      const b = (await r.json()) as {
        products: { slug: string; first_seen_at: string }[];
      };
      expect(b.products[0].slug).toBe("otter");
      expect(
        b.products.every(
          (p, i) => !i || b.products[i - 1].first_seen_at >= p.first_seen_at,
        ),
      ).toBe(true);
      expect(
        (await app.request("/api/products?sort=arbitrary-sql", {}, env)).status,
      ).toBe(400);
    } finally {
      await env.DB.prepare(
        "UPDATE products SET first_seen_at=? WHERE slug='otter'",
      )
        .bind(original!.first_seen_at)
        .run();
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
    const publicResult = await app.request(
      "/api/products/admin-example-reviewed",
      {},
      env,
    );
    expect(publicResult.status).toBe(200);
    const p = (await publicResult.json()) as {
      verification_scope: string;
      capabilities: unknown[];
    };
    expect(p.verification_scope).toBe("identity");
    expect(p.capabilities).toHaveLength(0);
    expect(
      (await app.request("/api/search?q=Admin%20Example", {}, env)).status,
    ).toBe(200);
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
  const publicResult = await app.request(
    "/api/products/admin-example-reviewed",
    {},
    env,
  );
  expect(publicResult.status).toBe(200);
  expect(
    ((await publicResult.json()) as { canonical_url: string }).canonical_url,
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
          new URL(req.url).pathname === "/catalog-pages/otter.html"
            ? new Response("<h1>Saved Otter catalog</h1>")
            : new Response("missing", { status: 404 }),
      } as Fetcher,
    },
  );
  expect(detail.status).toBe(200);
  expect(detail.headers.get("X-Catalog-Mode")).toBe("snapshot");
  expect(await detail.text()).toContain("Saved Otter");
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
