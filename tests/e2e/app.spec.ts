import { test, expect } from "@playwright/test";
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
  await expect(
    page.getByRole("heading", { name: "What it actually does." }),
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
