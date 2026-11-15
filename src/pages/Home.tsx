import { Link } from "react-router-dom";
import { SearchForm } from "../components/SearchForm";
import { ProductCard } from "../components/ProductCard";
import { BlueprintStamp, PixelArt } from "../components/PixelArt";
import { useApi } from "../useApi";
import type { Product } from "../lib/types";
const examples = [
  ["01", "THE SOLO EMPIRE", "A CRM for freelancers that handles invoicing"],
  ["02", "THE CONTENT MACHINE", "An app that automatically edits short videos"],
  [
    "03",
    "THE UNPAID INTERN",
    "A tool that schedules social posts across platforms",
  ],
  [
    "04",
    "THE MEETING SURVIVOR",
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
      <section className="hero blueprint-sheet">
        <div className="sheet-heading">
          <span>TCBA / DEPARTMENT OF QUESTIONABLE ORIGINALITY</span>
          <span>DRAWING NO. 001</span>
        </div>
        <div className="hero-layout">
          <div className="hero-title">
            <div className="hero-kicker">
              <span className="status-dot" /> YOUR NEXT BIG IDEA. FILE UNDER:
              PROBABLY EXISTS.
            </div>
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
          <figure className="hero-schematic">
            <span className="schematic-label">FIG. A / THE IDEA MACHINE</span>
            <div className="schematic-drawing">
              <PixelArt />
              <span className="schematic-callout">
                ORIGINALITY
                <br />
                NOT INCLUDED ↙
              </span>
            </div>
            <figcaption>
              INPUT: ONE BRILLIANT IDEA
              <br />
              OUTPUT: A SMALL REALITY CHECK
            </figcaption>
          </figure>
        </div>
        <div className="invention-input">
          <SearchForm />
          <p className="under-search">
            <span>NO ACCOUNT. NO AI PROPHECY. JUST ACTUAL SOFTWARE.</span>
            <span>* A joke. The counts below are real.</span>
          </p>
        </div>
        <div className="sheet-footer">
          <span>METHOD: SEARCH → COMPARE → RECONSIDER</span>
          <span>NOT A PATENT SEARCH.</span>
        </div>
      </section>
      <section className="examples-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              01 / START WITH A FAMILIAR INVENTION
            </span>
            <h2>Need an idea to ruin?</h2>
          </div>
          <PixelArt kind="bulb" />
        </div>
        <div className="examples-grid">
          {examples.map(([n, title, q]) => (
            <Link
              key={n}
              className="example"
              to={"/search?q=" + encodeURIComponent(q)}
            >
              <span className="eyebrow">
                CONCEPT {n} / {title}
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
            <span className="eyebrow">02 / RETRIEVED FROM THE ARCHIVE</span>
            <h2>Already a thing.</h2>
          </div>
          <Link className="text-link" to="/explore">
            OPEN THE ARCHIVE →
          </Link>
        </div>
        <div className="product-grid">
          {catalog.data?.products.slice(0, 3).map((p) => (
            <ProductCard key={p.slug} product={p} />
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
      <section className="manifesto blueprint-sheet">
        <PixelArt kind="crane" />
        <div>
          <span className="eyebrow">
            ENGINEER’S NOTE / PLEASE KEEP BUILDING
          </span>
          <h2>
            ALREADY BUILT.
            <br />
            NOT THE END.
          </h2>
          <p>
            Someone having built it doesn’t mean you shouldn’t.
            <br />
            It just means you should know.
          </p>
        </div>
        <BlueprintStamp />
      </section>
      <div className="catalog-note">
        <span className="status-dot" />
        {data
          ? `${data.products} PUBLISHED PRODUCTS`
          : "SOURCE-CHECKED SOFTWARE"}
        <span>DOCUMENTED CAPABILITIES. ZERO INVENTED SCORES.</span>
      </div>
    </>
  );
}
