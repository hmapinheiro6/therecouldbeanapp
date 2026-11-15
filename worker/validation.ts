import { z } from "zod";
export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.length > 253
  )
    throw new Error(
      "Use a public HTTPS website without credentials or a custom port.",
    );
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !host.includes(".") ||
    host.includes(":") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host)
  )
    throw new Error("Use a public website.");
  url.hostname = host;
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(ref|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}
export const httpsUrl = z
  .string()
  .max(2000)
  .transform((s, ctx) => {
    try {
      return canonicalizeUrl(s);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Enter a public HTTPS website URL.",
      });
      return z.NEVER;
    }
  });
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (s) => !/[<>]/.test(s) && !Array.from(s).some((c) => c.charCodeAt(0) < 9),
      "Use plain text.",
    );
export const submissionSchema = z
  .object({
    product_name: text(2, 100),
    submitted_url: httpsUrl,
    description: text(20, 600),
    category_hint: text(0, 80).optional(),
    contact_email: z.union([z.email().max(254), z.literal("")]).optional(),
    turnstile_token: z.string().min(1).max(2048),
    website: z.string().max(0).optional(),
  })
  .strict();
const date = z.iso.datetime();
export const productInput = z
  .object({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    name: text(2, 100),
    canonical_url: httpsUrl,
    short_description: text(20, 600),
    category_slug: z.string().max(80),
    audience: text(0, 160).default(""),
    search_aliases: text(0, 300).default(""),
    first_seen_at: date,
    last_verified_at: date,
    announced_at: date.nullable().default(null),
    capabilities: z
      .array(
        z.object({
          slug: z.string().max(80),
          evidence_url: httpsUrl,
          evidence_text: text(8, 600),
          verified_at: date,
        }),
      )
      .min(1)
      .max(12),
    source: z.object({
      source_type: z.enum([
        "official",
        "github",
        "hackernews",
        "feed",
        "submission",
      ]),
      source_name: text(2, 100),
      source_url: httpsUrl,
      external_id: text(1, 200),
      discovered_at: date,
    }),
    submission_id: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const official = new URL(p.canonical_url).hostname;
    for (const c of p.capabilities)
      if (new URL(c.evidence_url).hostname !== official)
        ctx.addIssue({
          code: "custom",
          message: "Evidence must come from the official website.",
        });
    const now = Date.now();
    if (
      Date.parse(p.last_verified_at) > now + 300000 ||
      Date.parse(p.last_verified_at) < now - 1000 * 86400 * 90
    )
      ctx.addIssue({
        code: "custom",
        message: "Verification must be within 90 days.",
      });
    if (
      p.capabilities.some(
        (c) =>
          Date.parse(c.verified_at) > now + 300000 ||
          Date.parse(c.verified_at) < now - 1000 * 86400 * 90,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Capability evidence must be recent.",
      });
  });
export const candidateInput = z.object({
  id: z.string().max(100),
  source_name: text(1, 100),
  source_url: httpsUrl,
  external_id: text(1, 200),
  name: text(1, 100),
  canonical_url: httpsUrl,
  status: z.enum([
    "discovered",
    "pending_verification",
    "verified",
    "published",
    "rejected",
    "needs_review",
  ]),
  reason: text(0, 500).nullable(),
  attempts: z.number().int().min(0).max(20),
  next_retry_at: date.nullable(),
  submission_id: z.string().uuid().nullable().optional(),
  created_at: date,
  updated_at: date,
});
export const ingestSchema = z
  .object({
    products: z.array(productInput).max(5).default([]),
    candidates: z.array(candidateInput).max(20).default([]),
    run: z
      .object({
        id: z.string().uuid(),
        source_name: text(1, 100),
        started_at: date,
        completed_at: date.nullable(),
        status: z.enum(["running", "success", "failed", "partial"]),
        candidates_found: z.number().int().min(0).max(100),
        records_accepted: z.number().int().min(0).max(100),
        records_rejected: z.number().int().min(0).max(100),
        records_pending: z.number().int().min(0).max(100),
        error_summary: text(0, 500).nullable(),
      })
      .optional(),
    checkpoints: z
      .array(
        z.object({ source_name: text(1, 100), cursor_value: text(0, 10000) }),
      )
      .max(10)
      .default([]),
  })
  .strict()
  .refine(
    (b) => !b.checkpoints.length || b.run?.status === "success",
    "Checkpoints require a successful completed run.",
  );
export const moderationSchema = z
  .object({
    kind: z.enum(["submission", "product", "candidate"]),
    id: z.string().max(100),
    action: z.enum(["approve", "reject", "retry", "remove"]),
    reason: text(3, 500),
  })
  .strict();
