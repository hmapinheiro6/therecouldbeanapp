import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "../useApi";
import type { Product } from "../lib/types";
import { canonicalOrigin, catalogPath, updatePageMetadata } from "../lib/seo";
import { NotFound } from "./Info";
import { ProductCard } from "../components/ProductCard";
export function Explore() {
  const [params] = useSearchParams();
  const route = useParams();
  const category = route.category ?? params.get("category") ?? "";
  const offset = route.page
    ? (Number(route.page) - 1) * 24
    : Number(params.get("offset") ?? 0);
  const sort = params.get("sort") === "name" ? "name" : "recent";
  const catalogLink = (
    nextCategory = category,
    nextOffset = 0,
    nextSort = sort,
  ) =>
    nextSort === "recent"
      ? catalogPath(nextCategory, nextOffset / 24 + 1)
      : catalogPath(nextCategory, nextOffset / 24 + 1) +
        "?" +
        new URLSearchParams({
          category: nextCategory,
          offset: String(nextOffset),
          sort: nextSort,
        });
  const catalog = useApi<{ products: Product[]; total: number }>(
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
  const selected = categories.data?.categories.find(
    (c) => c.slug === category && c.product_count > 0,
  );
  const page = offset / 24 + 1;
  const invalid =
    !Number.isInteger(page) ||
    page < 1 ||
    offset > 15000 ||
    !!(category && categories.data && !selected) ||
    !!(offset > 0 && catalog.data && !catalog.data.products.length);
  useEffect(() => {
    const path = catalogPath(category, page);
    updatePageMetadata(
      canonicalOrigin(),
      path,
      undefined,
      selected,
      catalog.data?.products,
      invalid,
    );
  }, [category, page, selected, catalog.data, invalid]);
  if (invalid) return <NotFound />;
  return (
    <div className="page">
      <h1 className="page-title">
        {selected
          ? `${selected.name} apps and software.`
          : "The invention archive."}
        {page > 1 ? ` Page ${page}.` : ""}
      </h1>
      <p className="page-intro">
        {selected
          ? `Browse ${selected.product_count} ${selected.name.toLowerCase()} listings with official websites and source details.`
          : "Real products with sources and verification details. A head start on your research."}{" "}
        Website identity checks and documented features are labelled separately.{" "}
        <Link to="/about">How we verify software</Link>.
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
        {catalog.data &&
          offset + catalog.data.products.length < catalog.data.total && (
            <Link to={catalogLink(category, offset + 24)}>Next →</Link>
          )}
      </nav>
    </div>
  );
}
