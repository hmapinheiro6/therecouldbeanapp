import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../useApi";
import type { Product } from "../lib/types";
import { ProductCard } from "../components/ProductCard";
export function Explore() {
  const [params] = useSearchParams();
  const category = params.get("category") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const catalog = useApi<{ products: Product[] }>(
    "/products?category=" + encodeURIComponent(category) + "&offset=" + offset,
  );
  const categories = useApi<{
    categories: { slug: string; name: string; product_count: number }[];
  }>("/categories");
  return (
    <div className="page">
      <span className="eyebrow">INDEPENDENTLY EXISTING SOFTWARE</span>
      <h1 className="page-title">The usual suspects.</h1>
      <p className="page-intro">
        Real products. Documented capabilities. A head start on your research.
      </p>
      <nav className="category-filter" aria-label="Filter products">
        <Link className={!category ? "selected" : ""} to="/explore">
          All software
        </Link>
        {categories.data?.categories
          .filter((c) => c.product_count > 0)
          .map((c) => (
            <Link
              className={category === c.slug ? "selected" : ""}
              key={c.slug}
              to={"/explore?category=" + c.slug}
            >
              {c.name} <small>{c.product_count}</small>
            </Link>
          ))}
      </nav>
      {catalog.loading && <p role="status">Retrieving the evidence…</p>}
      {catalog.error && (
        <p role="alert" className="notice error">
          {catalog.error}
        </p>
      )}
      <div className="product-grid">
        {catalog.data?.products.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>
      {catalog.data && !catalog.data.products.length && (
        <p className="empty-state">Nothing published in this category yet.</p>
      )}
      <nav className="pagination" aria-label="Catalog pages">
        {offset > 0 && (
          <Link
            to={"/explore?category=" + category + "&offset=" + (offset - 24)}
          >
            ← Previous
          </Link>
        )}
        {catalog.data?.products.length === 24 && (
          <Link
            to={"/explore?category=" + category + "&offset=" + (offset + 24)}
          >
            Next →
          </Link>
        )}
      </nav>
    </div>
  );
}
