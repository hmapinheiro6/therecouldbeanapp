import { Link } from "react-router-dom";
import { SearchForm } from "../components/SearchForm";
import { ProductCard } from "../components/ProductCard";
import { Monitor } from "../components/Monitor";
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
      <section className="hero monitor-hero" aria-label="Search the catalog">
        <Monitor>
          <div className="hero-title">
            <h1>
              THERE COULD BE
              <br />
              AN APP FOR THAT.
            </h1>
            <p className="hero-subtitle">
              There are probably 40.<span aria-hidden="true">*</span>
            </p>
            <p className="hero-copy">
              Describe your brilliant invention. We’ll find the people who
              already built it.
            </p>
          </div>
          <div className="invention-input">
            <SearchForm />
          </div>
        </Monitor>
        <p className="under-search monitor-disclaimer">
          No account needed. No pitch deck required.
          <span>* The 40 is a joke; the catalog count below is real.</span>
        </p>
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
              <PixelArt
                kind={
                  q.includes("CRM")
                    ? "disk"
                    : q.includes("videos")
                      ? "window"
                      : q.includes("social")
                        ? "crane"
                        : "bulb"
                }
              />
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
          New to this catalog, not necessarily newly launched. We check licensed
          directories, Show HN, GitHub, and founder submissions against official
          product pages. <Link to="/about">How discovery works →</Link>
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
      <section className="page prose" aria-labelledby="software-discovery">
        <h2 id="software-discovery">Find software before you build it.</h2>
        <p>
          There Could Be An App is a free software discovery catalog. Describe a
          task or app idea in plain language to find existing SaaS products,
          desktop applications and self-hosted tools. Browse the{" "}
          <Link to="/explore">software catalog by category</Link> or search for
          the capabilities you need.
        </p>
        <h3>How are software matches chosen?</h3>
        <p>
          Search compares your request with product descriptions and documented
          capabilities. Strong and partial matches reflect feature evidence;
          related products share relevant wording. These labels support research
          and do not guarantee that a product fits your needs.
        </p>
        <h3>Are all listed features verified?</h3>
        <p>
          No. “Official website checked” confirms product identity. “Features
          documented” means specific features have supporting excerpts from
          official sources. Each listing shows its sources and last source
          check. We have not tested every product hands-on.{" "}
          <Link to="/about">
            Read our verification method and coverage limits
          </Link>
          .
        </p>
        <h3>Can I submit an app?</h3>
        <p>
          Yes. <Link to="/submit">Submit your app for review</Link> without an
          account or payment. Publication requires an independent identity
          check; submitting a product does not guarantee inclusion.
        </p>
      </section>
    </>
  );
}
