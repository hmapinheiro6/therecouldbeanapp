import { describe, it, expect, afterAll } from "vitest";
import { database, search } from "../db";
import { rank } from "../../src/lib/search/rank";
import { parseQuery, normalize } from "../../src/lib/search/query";
import { readFileSync } from "node:fs";
const db = database();
afterAll(() => db.close());
describe("classical search", () => {
  it("recognizes conversational sales and follow-up intent", () => {
    const i = parseQuery(
      "I was thinking of making an application that helps my salespeople remember who they need to contact again.",
    );
    expect(i.capabilities).toContain("crm");
    expect(i.capabilities).toContain("reminders");
  });
  it("maps invoice misspellings and morphology", () => {
    expect(normalize("INVOCING   calender")).toBe("invoicing calendar");
    expect(
      search(db, "invocing").some((p) =>
        p.matched.some((c) => c.slug === "invoicing"),
      ),
    ).toBe(true);
  });
  it("does not expand an ambiguous pipeline into sales or CI", () => {
    expect(parseQuery("pipeline").capabilities).toEqual([]);
  });
  it("identifies multiple requirements", () => {
    expect(
      parseQuery("A CRM that tracks projects and sends invoices").capabilities,
    ).toEqual(expect.arrayContaining(["crm", "projects", "invoicing"]));
  });
  it("keeps negation and excludes the unwanted capability", () => {
    expect(
      parseQuery("project management without invoicing").excluded,
    ).toContain("invoicing");
    expect(
      search(db, "project management without invoicing").every(
        (p) => !p.capabilities.some((c) => c.slug === "invoicing"),
      ),
    ).toBe(true);
  });
  it("never assumes unknown essential requirements", () => {
    for (const p of search(db, "offline CRM for dentists"))
      expect(p.match_class).not.toBe("Strong match");
  });
  it("returns a strong exact name match and real capability evidence", () => {
    const r = search(db, "Otter");
    expect(r[0].name).toBe("Otter");
    expect(r[0].match_class).toBe("Strong match");
    expect(r[0].capabilities.length).toBeGreaterThan(0);
  });
  it("places coverage of multiple requirements above a single requirement", () => {
    const r = search(db, "meeting transcription and action items");
    expect(r[0].matched.length).toBe(2);
    expect(r[0].match_class).toBe("Strong match");
  });
  it("handles FTS operators as plain tokens", () => {
    expect(() =>
      search(db, '" OR * NEAR ) -- ; DROP TABLE products'),
    ).not.toThrow();
    expect(
      db.prepare("SELECT count(*) n FROM products").get()?.n,
    ).toBeGreaterThan(0);
  });
  it("does not fabricate unknown matches", () => {
    expect(search(db, "quantum telepathy dolphin translator")).toEqual([]);
  });
});
describe("database integrity", () => {
  it("keeps seeds idempotent and FTS synchronized", () => {
    const before = db.prepare("SELECT count(*) n FROM products").get()?.n;
    db.exec(readFileSync("data/seeds/catalog.sql", "utf8"));
    expect(db.prepare("SELECT count(*) n FROM products").get()?.n).toBe(before);
    expect(db.prepare("SELECT count(*) n FROM product_fts").get()?.n).toBe(
      before,
    );
  });
  it("removes unpublished products from the index and restores edits", () => {
    const p = db.prepare("SELECT id FROM products WHERE slug='otter'").get()!;
    db.prepare("UPDATE products SET status='needs_review' WHERE id=?").run(
      p.id,
    );
    expect(search(db, "Otter").some((p) => p.slug === "otter")).toBe(false);
    db.prepare("UPDATE products SET status='published' WHERE id=?").run(p.id);
    expect(search(db, "Otter")[0].slug).toBe("otter");
  });
  it("rebuilds the FTS index without virtual-table exports", () => {
    const before = search(db, "meeting notes").map((p) => p.slug);
    db.exec(readFileSync("scripts/rebuild-fts.sql", "utf8"));
    expect(search(db, "meeting notes").map((p) => p.slug)).toEqual(before);
  });
  it("updates capability index entries on removal", () => {
    db.exec("SAVEPOINT cap_test");
    const p = db.prepare("SELECT id FROM products WHERE slug='otter'").get()!;
    db.prepare("DELETE FROM product_capabilities WHERE product_id=?").run(p.id);
    expect(
      search(db, "meeting transcription").find((p) => p.slug === "otter")
        ?.matched ?? [],
    ).toEqual([]);
    db.exec("ROLLBACK TO cap_test; RELEASE cap_test");
  });
  it("enforces uniqueness without merging a shared parent domain", () => {
    db.exec("SAVEPOINT domain_test");
    db.exec(
      "INSERT INTO products(slug,name,canonical_url,normalized_domain,short_description,category_id,status,first_seen_at) SELECT 'same-parent','Distinct product','https://otter.ai/another-product','otter.ai','A distinct software product on a shared company domain.',category_id,'pending_verification',first_seen_at FROM products WHERE slug='otter'",
    );
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM products WHERE normalized_domain='otter.ai'",
        )
        .get()?.n,
    ).toBe(2);
    db.exec("ROLLBACK TO domain_test; RELEASE domain_test");
  });
});

it("does not assert unknown essential requirements from a generic capability match", () => {
  const results = search(
    db,
    "a password manager that translates dolphin thoughts",
  );
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((p) => p.match_class !== "Strong match")).toBe(true);
  expect(results[0].missing.join(" ")).toContain("dolphin");
});

it("uses edited public listing text immediately after a previous search", () => {
  search(db, "Otter");
  db.exec("SAVEPOINT edited_listing");
  try {
    db.prepare(
      "UPDATE products SET name='Otter Revised',short_description='A revised meeting transcription application.' WHERE slug='otter'",
    ).run();
    const result = search(db, "Otter Revised").find((p) => p.slug === "otter");
    expect(result?.match_class).toBe("Strong match");
    expect(result?.name).toBe("Otter Revised");
  } finally {
    db.exec("ROLLBACK TO edited_listing; RELEASE edited_listing");
  }
  expect(search(db, "Otter")[0].match_class).toBe("Strong match");
});

it("returns identity-only keyword matches without asserting verified capabilities", () => {
  const base = search(db, "Otter")[0];
  const result = rank(
    [
      {
        ...base,
        id: 99999,
        name: "Paper Workshop",
        canonical_url: "https://paper-workshop.dev",
        short_description: "A PDF editor for desktop documents.",
        capabilities: [],
        verification_scope: "identity",
        bm25: -1,
      },
    ],
    parseQuery("PDF editor"),
  );
  expect(result).toHaveLength(1);
  expect(result[0].match_class).toBe("Related product");
  expect(result[0].matched).toEqual([]);
});
