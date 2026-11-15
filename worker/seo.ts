import type { Product } from "../src/lib/types";
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function productSummary(p: Product) {
  const e = escapeHtml;
  return `<article class="page product-detail"><p>Source-backed product catalog</p><h1 class="page-title">${e(p.name)}</h1><p>${e(p.short_description)}</p><p><a href="${e(p.canonical_url)}" rel="noopener noreferrer">Official website: ${e(p.normalized_domain)}</a></p><h2>Verified capabilities</h2><ul>${p.capabilities.map((c) => `<li><strong>${e(c.name)}</strong>: ${e(c.evidence_text)} <a href="${e(c.evidence_url)}">Official evidence</a></li>`).join("")}</ul><p>Category: ${e(p.category)}. First seen: ${e(p.first_seen_at.slice(0, 10))}. Last verified: ${e(p.last_verified_at.slice(0, 10))}.</p></article>`;
}
