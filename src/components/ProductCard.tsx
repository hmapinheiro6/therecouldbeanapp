import { useState } from "react";
import { Link } from "react-router-dom";
import type { Product, SearchResult } from "../lib/types";
import type { ProductPreview as Preview } from "../lib/previews";
import { ProductIntelligence } from "./ProductIntelligence";
import { ProductPreview } from "./ProductPreview";
export function ProductCard({
  product,
  index,
  showAdded = false,
}: {
  product: Product | SearchResult;
  index?: number;
  showAdded?: boolean;
}) {
  const result = "match_class" in product ? product : null;
  const [preview, setPreview] = useState<Preview | null>(null);
  const capabilities = (result ? result.matched : product.capabilities).slice(
    0,
    3,
  );
  const publisherDescription =
    product.verification_scope === "identity" &&
    preview?.canonical_url === product.canonical_url
      ? preview.description
      : "";
  return (
    <article
      className={
        "product-card " +
        (result
          ? "search-dossier " +
            (result.match_class === "Strong match"
              ? "match-strong"
              : result.match_class === "Partial match"
                ? "match-partial"
                : "match-related")
          : "catalog-dossier")
      }
    >
      <ProductPreview product={product} onMetadata={setPreview} />
      <div className="card-content">
        <div className="card-title-row">
          <h3>
            <Link to={"/apps/" + product.slug}>{product.name}</Link>
          </h3>
          {result && (
            <span className="match-label">
              <span className="match-signal" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {result.match_class}
            </span>
          )}
          {index !== undefined && (
            <span className="sr-only">Result {index + 1}</span>
          )}
        </div>
        <a
          className="domain"
          href={product.canonical_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {product.normalized_domain} <span aria-hidden="true">↗</span>
        </a>
        <p className="card-description">
          {publisherDescription || product.short_description}
        </p>
        {publisherDescription && (
          <span className="publisher-attribution">Publisher description</span>
        )}
        {capabilities.length > 0 && (
          <div className="tags">
            {capabilities.map((capability) => (
              <span key={capability.slug}>✓ {capability.name}</span>
            ))}
          </div>
        )}
        {product.verification_scope === "identity" && (
          <p className="verification-note">
            Official website checked · Features not verified.
          </p>
        )}
        <ProductIntelligence product={product} compact />
        <div className="card-meta">
          <span>{product.category}</span>
          {showAdded && (
            <time dateTime={product.first_seen_at}>
              Added{" "}
              {new Date(product.first_seen_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </time>
          )}
        </div>
        <div className="card-actions">
          <details className="card-findings">
            <summary>{result ? "Why it matches" : "What we know"}</summary>
            <div className="card-evidence">
              {result && <p>{result.explanation}</p>}
              {product.verification_scope === "identity" ? (
                <p>
                  The official website confirms this product’s identity. Its
                  features have not been verified.
                </p>
              ) : (
                product.capabilities.length > 0 && (
                  <p>
                    Features documented in official sources. This is a source
                    check, not a hands-on review.
                  </p>
                )
              )}
              {result && result.missing.length > 0 && (
                <p>Not yet evidenced: {result.missing.join(", ")}.</p>
              )}
              {capabilities.slice(0, 2).map((capability) => (
                <p key={capability.slug}>
                  <a
                    href={capability.evidence_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {capability.name} evidence ↗
                  </a>
                </p>
              ))}
              <p>
                Product checked{" "}
                {new Date(product.last_verified_at).toLocaleDateString("en-GB")}
                .
              </p>
              {preview?.title && <p>Website title: {preview.title}</p>}
              {preview && (
                <p>
                  <a
                    href={preview.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Publisher metadata ↗
                  </a>{" "}
                  · collected{" "}
                  {new Date(preview.checked_at).toLocaleDateString("en-GB")}
                </p>
              )}
            </div>
          </details>
          <Link className="card-primary" to={"/apps/" + product.slug}>
            Open findings <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
