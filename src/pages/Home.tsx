import { Link } from "react-router-dom";
import { SearchForm } from "../components/SearchForm";
import { ProductCard } from "../components/ProductCard";
import { PixelArt } from "../components/PixelArt";
import { useApi } from "../useApi";
import type { Product } from "../lib/types";
const examples = [
  "A CRM for freelancers that handles invoicing",
  "An app that automatically edits short videos",
  "A tool that schedules social posts across platforms",
  "An AI assistant that takes notes during meetings",
];
export function Home() {
  const { data } = useApi<{ products: number; catalog_updated_at: string }>(
    "/stats",
  );
  const catalog = useApi<{ products: Product[] }>("/products?sort=recent");
  return (
    <>
      <section className="hero blueprint-sheet">
        <div className="hero-layout">
          <div className="hero-title">
            <h1>
              THERE COULD BE
              <br />
              AN APP
              <br />
              FOR THAT.
            </h1>
            <p className="hero-subtitle">
              There are probably 40.<span aria-hidden="true">*</span>
            </p>
            <p className="hero-copy">
              Describe your brilliant invention.
              <br />
              We’ll find the people who already built it.
            </p>
          </div>
          <figure className="hero-schematic" aria-hidden="true">
            <div className="schematic-drawing">
              <PixelArt />
            </div>
          </figure>
        </div>
        <div className="invention-input">
          <SearchForm />
          <p className="under-search">
            No account needed. * The 40 is a joke; the catalog count below is
            real.
          </p>
        </div>
      </section>
      <section className="examples-section">
        <div className="section-heading">
          <div>
            <h2>Need an idea to ruin?</h2>
          </div>
          <PixelArt kind="bulb" />
        </div>
        <div className="examples-grid">
          {examples.map((q) => (
            <Link
              key={q}
              className="example"
              to={"/search?q=" + encodeURIComponent(q)}
            >
              <p>{q}</p>
              <span className="example-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="catalog-preview">
        <div className="section-heading">
          <div>
            <h2>Recently added.</h2>
          </div>
          <Link className="text-link" to="/explore">
            Explore all apps →
          </Link>
        </div>
        <p className="discovery-note">
          New to this catalog, not necessarily newly launched. We check Show HN,
          GitHub, and founder submissions against official product pages.{" "}
          <Link to="/about">How discovery works →</Link>
        </p>
        <div className="product-grid">
          {catalog.data?.products.slice(0, 3).map((p) => (
            <ProductCard key={p.slug} product={p} showAdded />
          ))}
          {catalog.loading && (
            <p className="loading-state" role="status">
              <span className="loading-bar" />
              RETRIEVING DOSSIERS…
            </p>
          )}
          {catalog.error && (
            <p className="notice" role="alert">
              The archive is temporarily unavailable. Please try again shortly.
            </p>
          )}
        </div>
      </section>
      <div className="catalog-note">
        <span className="status-dot" />
        {data
          ? `${data.products} PUBLISHED PRODUCTS`
          : "SOURCE-CHECKED SOFTWARE"}
      </div>
    </>
  );
}
