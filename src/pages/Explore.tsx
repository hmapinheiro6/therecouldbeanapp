import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../useApi";
import type { Product } from "../lib/types";
import { ProductCard } from "../components/ProductCard";
import { SnapshotNotice } from "../components/SnapshotNotice";
export function Explore() {
  const [params] = useSearchParams();
  const category = params.get("category") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const sort = params.get("sort") === "name" ? "name" : "recent";
  const catalogLink = (
    nextCategory = category,
    nextOffset = 0,
    nextSort = sort,
  ) =>
    "/explore?" +
    new URLSearchParams({
      category: nextCategory,
      offset: String(nextOffset),
      sort: nextSort,
    });
  const catalog = useApi<{ products: Product[] }>(
    "/products?category=" +
      encodeURIComponent(category) +
      "&offset=" +
      offset +
      "&sort=" +
      sort,
  );
  const categories = useApi<{
    categories: { slug: string; name: string; product_count: number }[];
  }>("/categories");
  return (
    <div className="page">
      <SnapshotNotice at={catalog.snapshotAt} />
      <h1 className="page-title">The invention archive.</h1>
      <p className="page-intro">
        Real products with sources and verification details. A head start on
        your research.
      </p>
      <nav className="category-filter" aria-label="Filter products">
        <Link className={!category ? "selected" : ""} to={catalogLink("")}>
          All software
        </Link>
        {categories.data?.categories
          .filter((c) => c.product_count > 0)
          .map((c) => (
            <Link
              className={category === c.slug ? "selected" : ""}
              key={c.slug}
              to={catalogLink(c.slug)}
            >
              {c.name} <small>{c.product_count}</small>
            </Link>
          ))}
      </nav>
      <nav className="catalog-order" aria-label="Sort products">
        <Link
          to={catalogLink(category, 0, "recent")}
          aria-current={sort === "recent" ? "page" : undefined}
        >
          Recently added
        </Link>
        <Link
          to={catalogLink(category, 0, "name")}
          aria-current={sort === "name" ? "page" : undefined}
        >
          A–Z
        </Link>
      </nav>
      {catalog.loading && <p role="status">Retrieving the evidence…</p>}
      {catalog.error && (
        <p role="alert" className="notice error">
          {catalog.error}
        </p>
      )}
      <div className="product-grid">
        {catalog.data?.products.map((p) => (
          <ProductCard key={p.slug} product={p} showAdded={sort === "recent"} />
        ))}
      </div>
      {catalog.data && !catalog.data.products.length && (
        <p className="empty-state">Nothing published in this category yet.</p>
      )}
      <nav className="pagination" aria-label="Catalog pages">
        {offset > 0 && (
          <Link to={catalogLink(category, offset - 24)}>← Previous</Link>
        )}
        {catalog.data?.products.length === 24 && (
          <Link to={catalogLink(category, offset + 24)}>Next →</Link>
        )}
      </nav>
    </div>
  );
}
