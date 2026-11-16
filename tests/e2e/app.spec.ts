import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const previewFixture = JSON.parse(
  readFileSync(new URL("../preview-fixture.json", import.meta.url), "utf8"),
);
// Preview enrichment is tested with fixtures; the test suite never fans out to GitHub.
test.beforeEach(async ({ page }) => {
  await page.route("**/catalog-previews/*.json", (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.route("**/api/previews/*", (route) =>
    route.fulfill({ status: 204 }),
  );
});
test("homepage sends a real search and exposes source-backed results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "THERE COULD BE",
  );
  await page
    .getByLabel("Describe your app idea")
    .fill("meeting transcription and action items");
  await page.getByRole("button", { name: "Ruin my idea" }).click();
  await expect(page).toHaveURL(/search\?q=/);
  await expect(
    page.getByRole("heading", { name: "Otter", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Strong match", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "Otter", exact: true })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/apps\/otter$/);
  await expect(
    page.getByRole("heading", { name: "Features documented" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Official evidence ↗" }).first(),
  ).toHaveAttribute("href", /^https:\/\/otter.ai/);
});
test("empty queries show accessible feedback and Enter searches", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ruin my idea" }).click();
  await expect(page.getByRole("alert")).toContainText("At least two");
  await page.getByLabel("Describe your app idea").fill("Otter");
  await page.getByLabel("Describe your app idea").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Otter", exact: true }),
  ).toBeVisible();
});
test("no-result state offers a user-initiated external fallback", async ({
  page,
}) => {
  await page.goto("/search?q=quantum%20telepathy%20dolphin%20translator");
  await expect(
    page.getByRole("heading", { name: "We couldn't find a close match." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Search the web ↗" }),
  ).toHaveAttribute("href", /google.com\/search\?q=/);
});
test("submission form validates inputs and truthfully reports disabled protection", async ({
  page,
}) => {
  await page.goto("/submit");
  await expect(page.getByLabel("Product name")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit my app ↗" }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(
    "temporarily unavailable",
  );
  await page.getByLabel("Product name").fill("Example product");
  await page.getByLabel("Official website").fill("https://example.dev");
  await page
    .getByLabel("What does it do?")
    .fill("A useful product with a public official website.");
});
test("navigation and mobile layouts remain usable", async ({ page }) => {
  for (const path of [
    "/",
    "/explore",
    "/about",
    "/privacy",
    "/terms",
    "/submit",
    "/apps/otter",
    "/missing",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("heading", { name: "There isn’t a page for that." }),
  ).toBeVisible();
});
test("shareable URLs work directly and queries are not indexable", async ({
  page,
  request,
}) => {
  await page.goto("/search?q=Otter");
  await expect(
    page.getByRole("heading", { name: "Otter", exact: true }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
  const detail = await request.get("/apps/otter");
  const html = await detail.text();
  expect(html.match(/rel="canonical"/g)).toHaveLength(1);
  expect(html).toMatch(/rel="canonical" href="[^"]+\/apps\/otter"/);
  const result = await request.get("/api/search?q=crm%20%22%20OR%20%2A%20--");
  expect(result.status()).toBe(200);
});

test("operator can sign in, review, and publish an app without the CLI", async ({
  page,
  request,
}, testInfo) => {
  const { createHash, createHmac, randomUUID } = await import("node:crypto");
  const stamp = new Date().toISOString();
  const suffix = testInfo.project.name + "-" + randomUUID().slice(0, 8);
  const path = "/api/internal/ingest";
  const body = JSON.stringify({
    candidates: [
      {
        id: "e2e-review-" + suffix,
        source_name: "Isolated E2E fixture",
        source_url: "https://example.dev",
        external_id: "e2e-review-" + suffix,
        name: "Review Fixture " + suffix,
        canonical_url: "https://example.dev/" + suffix,
        status: "needs_review",
        reason: "Isolated browser test fixture",
        attempts: 1,
        next_retry_at: null,
        created_at: stamp,
        updated_at: stamp,
      },
    ],
  });
  const timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = randomUUID();
  const signature = createHmac(
    "sha256",
    "isolated-e2e-signing-key-for-local-tests-only",
  )
    .update(
      [
        "POST",
        path,
        timestamp,
        nonce,
        createHash("sha256").update(body).digest("hex"),
      ].join("\n"),
    )
    .digest("hex");
  expect(
    (
      await request.post(path, {
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": timestamp,
          "X-Nonce": nonce,
          "X-Signature": signature,
        },
        data: body,
      })
    ).status(),
  ).toBe(200);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Catalog review" }),
  ).toBeVisible();
  await page
    .getByLabel("Admin access key")
    .fill("isolated-e2e-admin-access-key-for-local-tests-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "Find an app" })
    .fill("Review Fixture " + suffix);
  await page
    .getByRole("region", { name: "Review queue" })
    .getByRole("button")
    .filter({ hasText: "Review Fixture " + suffix })
    .click();
  await page.getByLabel("Public URL slug").fill("review-fixture-" + suffix);
  await page
    .getByLabel("Description", { exact: true })
    .fill(
      "An isolated local application fixture used to test the complete review flow.",
    );
  await page
    .getByLabel("Official identity excerpt")
    .fill("Review Fixture " + suffix + " official test application");
  await page
    .getByLabel("Review note")
    .fill("Checked the isolated test fixture.");
  await page
    .getByRole("checkbox", {
      name: "I checked the official website and the evidence entered above.",
    })
    .check();
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.getByRole("status")).toContainText("publish completed");
  await page.goto("/apps/review-fixture-" + suffix);
  await expect(
    page.getByRole("heading", {
      name: "Review Fixture " + suffix,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Official website checked" }),
  ).toBeVisible();
});

test("public browsing and search recover transparently when D1's daily allowance is exhausted", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "database_daily_limit",
          message: "Daily database limit reached.",
        },
      }),
    }),
  );
  await page.goto("/explore");
  await expect(
    page.getByRole("status").filter({ hasText: "saved catalog" }),
  ).toBeVisible();
  await expect(page.locator(".product-card").first()).toBeVisible();
  await page.goto("/search?q=Otter");
  await expect(
    page.getByRole("status").filter({ hasText: "saved catalog" }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "Otter", exact: true })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/apps\/otter$/);
  await expect(
    page.getByRole("heading", { name: "Otter", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "saved catalog" }),
  ).toBeVisible();
});

test("search helpers assist without submitting or taking over typing", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Describe your app idea");
  await page.locator("main").focus();
  await page.keyboard.press("/");
  await expect(input).toBeFocused();
  await input.fill("An app for designers");
  await input.press("/");
  await expect(input).toHaveValue("An app for designers/");
  await page.getByRole("button", { name: "What makes a good search?" }).click();
  await expect(page.getByText("Start with", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Hide search tips" }).click();
  await expect(page.locator("#idea-tip")).toHaveCount(0);
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(input).toHaveValue(
    "A CRM for freelancers that handles invoicing",
  );
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(input).toHaveValue("A tool that turns meetings into tasks");
  await input.press("Enter");
  await expect(page).toHaveURL(/search\?q=A%20tool/);
  await expect(
    page.getByRole("heading", { name: "Otter", exact: true }),
  ).toBeVisible();
});

test("monitor easter egg works by keyboard and leaves search alone", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByLabel("Describe your app idea");
  await input.fill("Keep this idea");
  const machine = page.getByRole("button", {
    name: "Press the monitor power button for a thought",
  });
  await machine.focus();
  await machine.press("Enter");
  await expect(page.locator("#machine-hint")).toContainText("Name the task");
  await machine.press("Space");
  await expect(page.locator("#machine-hint")).toContainText(
    "useful difference",
  );
  await machine.press("Enter");
  await expect(page.locator("#machine-hint")).toContainText(
    "answer to everything",
  );
  await machine.press("Enter");
  await expect(page.locator("#machine-hint")).toContainText(
    "Describe. Search. Reconsider.",
  );
  await expect(input).toHaveValue("Keep this idea");
});

test("reduced motion and narrow screens keep the new controls usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await page.getByRole("button", { name: "What makes a good search?" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".route-content")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  expect(
    await page
      .locator(".monitor-message")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await expect(
    page.getByRole("button", {
      name: "Press the monitor power button for a thought",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ruin my idea" }),
  ).toBeVisible();
});

test("ghost suggestions type without becoming a query and pause during input", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  const input = page.getByLabel("Describe your app idea");
  const ghost = page.locator(".ghost-suggestion");
  await expect(ghost).toHaveAttribute("aria-hidden", "true");
  await page.clock.runFor(1000);
  const first = await ghost.locator(".suggestion-motion").textContent();
  await page.clock.runFor(200);
  expect(await ghost.locator(".suggestion-motion").textContent()).not.toBe(
    first,
  );
  await expect(input).toHaveValue("");
  await input.focus();
  const focused = await ghost.textContent();
  await page.clock.runFor(1000);
  expect(await ghost.textContent()).toBe(focused);
  await input.fill("My own idea");
  await expect(ghost).toHaveCount(0);
  await expect(input).toHaveValue("My own idea");
});

test("search entry is smaller, enforces 160 characters, and offers a static reduced-motion hint", async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const input = page.getByLabel("Describe your app idea");
  await expect(page.locator(".suggestion-static")).toBeVisible();
  await expect(page.locator(".suggestion-motion")).toBeHidden();
  expect(
    await input.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(82);
  await input.fill("a".repeat(170));
  await expect(input).toHaveValue("a".repeat(160));
  await expect(page.locator("#idea-limit")).toContainText("160 / 160");
  await input.press("b");
  await expect(input).toHaveValue("a".repeat(160));
  expect((await request.get("/api/search?q=" + "a".repeat(161))).status()).toBe(
    400,
  );
});

test("cards show lazy cached previews and keep evidence behind a clear disclosure", async ({
  page,
}) => {
  const preview = previewFixture;
  await page.route("**/api/previews/otter", (route) =>
    route.fulfill({ json: preview }),
  );
  await page.goto("/search?q=meeting%20notes");
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Otter", exact: true }) });
  await expect(card.locator(".product-preview img")).toBeVisible();
  expect(
    await card
      .locator("img")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBe(true);
  await expect(
    card.getByText("Website preview", { exact: true }),
  ).toBeVisible();
  await expect(card.locator(".card-evidence")).toBeHidden();
  await card.getByText("Why it matches", { exact: true }).click();
  await expect(card.locator(".card-evidence")).toContainText(
    "Features documented in official sources",
  );
  await expect(
    card.getByRole("link", { name: "Publisher metadata" }),
  ).toHaveAttribute("href", "https://otter.ai/meeting-notes");
  await card.getByRole("link", { name: "Open findings" }).click();
  await expect(
    page.getByRole("heading", { name: "Features documented" }),
  ).toBeVisible();
});

test("preview failure leaves cards usable and publisher text never becomes verified capability chips", async ({
  page,
}) => {
  const preview = previewFixture;
  await page.route("**/api/products?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.products = [
      {
        ...data.products[0],
        id: 99999,
        slug: "identity-preview-fixture",
        name: "Identity Preview Fixture",
        canonical_url: "https://identity-preview.dev",
        normalized_domain: "identity-preview.dev",
        verification_scope: "identity",
        short_description: "Original source description.",
        capabilities: [],
      },
    ];
    await route.fulfill({ json: data });
  });
  await page.route("**/api/previews/identity-preview-fixture", (route) =>
    route.fulfill({
      json: {
        ...preview,
        slug: "identity-preview-fixture",
        canonical_url: "https://identity-preview.dev",
        source_url: "https://identity-preview.dev",
        description: "Publisher says it can do absolutely everything.",
        image: {
          ...preview.image,
          data: "data:image/webp;base64,UklGRinvalid",
        },
      },
    }),
  );
  await page.goto("/explore");
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Identity Preview Fixture" }),
  });
  await expect(
    card.getByText("Publisher description", { exact: true }),
  ).toBeVisible();
  await expect(card.locator(".preview-fallback")).toBeVisible();
  await expect(card.locator(".verification-note")).toContainText(
    "Features not verified",
  );
  await expect(card.locator(".tags")).toHaveCount(0);
  await expect(card.getByRole("link", { name: "Open findings" })).toBeVisible();
});

test("fresh bundled previews use static assets and avoid a Worker request", async ({
  page,
}) => {
  let dynamicRequests = 0;
  await page.route("**/api/previews/otter", (route) => {
    dynamicRequests++;
    return route.fulfill({ status: 204 });
  });
  await page.route("**/catalog-previews/otter.json", (route) =>
    route.fulfill({
      json: { ...previewFixture, checked_at: new Date().toISOString() },
    }),
  );
  await page.goto("/search?q=Otter");
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Otter", exact: true }) });
  await expect(card.locator(".product-preview img")).toBeVisible();
  expect(dynamicRequests).toBe(0);
});
