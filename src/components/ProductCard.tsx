import { Link } from "react-router-dom";
import type { Product, SearchResult } from "../lib/types";
export function ProductCard({
  product,
  index,
}: {
  product: Product | SearchResult;
  index?: number;
}) {
  const result = "match_class" in product ? product : null;
  return (
    <article
      className={
        "product-card " +
        (result
          ? result.match_class === "Strong match"
            ? "match-strong"
            : result.match_class === "Partial match"
              ? "match-partial"
              : "match-related"
          : "catalog-dossier")
      }
    >
      <div className="dossier-heading">
        <span>FILE / {String(product.id).padStart(4, "0")}</span>
        <span>SOFTWARE DOSSIER</span>
      </div>
      <div className="card-top">
        <div className="product-monogram" aria-hidden="true">
          {product.name.slice(0, 1)}
        </div>
        <span className="eyebrow">
          {result && (
            <span className="match-signal" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          {result ? result.match_class : "VERIFIED LISTING"}
        </span>
        {index !== undefined && (
          <span className="result-number">
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
      </div>
      <h3>
        <Link to={"/apps/" + product.slug}>{product.name}</Link>
      </h3>
      <a
        className="domain"
        href={product.canonical_url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {product.normalized_domain} <span aria-hidden="true">↗</span>
      </a>
      <p>{product.short_description}</p>
      {result && <p className="match-explanation">{result.explanation}</p>}
      <div className="tags">
        {(result ? result.matched : product.capabilities)
          .slice(0, 4)
          .map((c) => (
            <span key={c.slug}>✓ {c.name}</span>
          ))}
      </div>
      <div className="card-bottom">
        <span>{product.category}</span>
        <Link to={"/apps/" + product.slug}>
          View evidence <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}
