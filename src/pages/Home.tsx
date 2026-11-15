import { Link } from "react-router-dom";
import { SearchForm } from "../components/SearchForm";
import { ProductCard } from "../components/ProductCard";
import { useApi } from "../useApi";
import type { Product } from "../lib/types";
const examples = [
  ["01", "The solo empire", "A CRM for freelancers that handles invoicing"],
  ["02", "The content machine", "An app that automatically edits short videos"],
  [
    "03",
    "The unpaid intern",
    "A tool that schedules social posts across platforms",
  ],
  [
    "04",
    "The meeting survivor",
    "An AI assistant that takes notes during meetings",
  ],
];
export function Home() {
  const { data } = useApi<{ products: number; catalog_updated_at: string }>(
    "/stats",
  );
  const catalog = useApi<{ products: Product[] }>("/products");
  return (
    <>
      <section className="hero">
        <div className="hero-kicker">
          <span className="status-dot" /> A REALITY CHECK FOR YOUR NEXT BIG IDEA
        </div>
        <h1>
          There could be
          <br />
          an app for that.
          <br />
          <em>There are probably 40.</em>
        </h1>
        <p className="hero-copy">
          Describe your groundbreaking app idea.
          <br />
          We’ll find the people who already built it.
        </p>
        <SearchForm />
        <p className="under-search">
          <span>No account. No AI prophecy. Just actual software.</span>
          <span className="handwritten">Sorry in advance. ↖</span>
        </p>
      </section>
      <section className="examples-section">
        <div className="section-heading">
          <h2>Need an idea to ruin?</h2>
          <p>Here are a few suspiciously original ones.</p>
        </div>
        <div className="examples-grid">
          {examples.map(([n, title, q]) => (
            <Link
              key={n}
              className="example"
              to={"/search?q=" + encodeURIComponent(q)}
            >
              <span className="eyebrow">
                {n} / {title}
              </span>
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
            <span className="eyebrow">THE EVIDENCE LOCKER</span>
            <h2>Already a thing.</h2>
          </div>
          <Link className="text-link" to="/explore">
            Explore the catalog ↗
          </Link>
        </div>
        <div className="product-grid">
          {catalog.data?.products.slice(0, 3).map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
          {catalog.loading && <p role="status">Opening the evidence locker…</p>}
          {catalog.error && (
            <p className="notice">
              The catalog is taking a moment. Search will be available when the
              service returns.
            </p>
          )}
        </div>
      </section>
      <section className="manifesto">
        <span className="eyebrow">A SMALL REALITY CHECK</span>
        <p>
          Someone having built it
          <br />
          doesn’t mean you shouldn’t.
        </p>
        <span>It just means you should know.</span>
      </section>
      <div className="catalog-note">
        <span className="status-dot" />
        {data
          ? `${data.products} published products. Source-backed capabilities. Zero invented scores.`
          : "Source-backed capabilities. Zero invented scores."}
      </div>
    </>
  );
}
