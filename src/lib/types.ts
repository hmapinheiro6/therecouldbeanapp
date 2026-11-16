export interface Capability {
  slug: string;
  name: string;
  evidence_url: string;
  evidence_text: string;
  verified_at: string;
}
export interface Product {
  id: number;
  slug: string;
  name: string;
  canonical_url: string;
  normalized_domain: string;
  short_description: string;
  search_aliases?: string;
  category: string;
  category_slug: string;
  audience: string;
  first_seen_at: string;
  announced_at: string | null;
  last_verified_at: string;
  verification_scope?: "identity" | "capabilities";
  identity_evidence_url?: string;
  identity_evidence_text?: string;
  capabilities: Capability[];
  sources?: {
    source_name: string;
    source_url: string;
    discovered_at: string;
  }[];
}
export interface SearchResult extends Product {
  match_class: "Strong match" | "Partial match" | "Related product";
  matched: Capability[];
  missing: string[];
  explanation: string;
  score: number;
}
export interface SearchResponse {
  query: string;
  requested: string[];
  qualifiers: string[];
  summary: { strong: number; partial: number; related: number };
  verdict: string;
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  catalog_updated_at: string | null;
  elapsed_ms: number;
}
