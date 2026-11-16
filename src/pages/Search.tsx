import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../useApi";
import type { SearchResponse } from "../lib/types";
import { SearchForm } from "../components/SearchForm";
import { PixelArt } from "../components/PixelArt";
import { ProductCard } from "../components/ProductCard";
import { SnapshotNotice } from "../components/SnapshotNotice";
export function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const { data, error, loading, snapshotAt } = useApi<SearchResponse>(
    "/search?q=" + encodeURIComponent(q) + "&offset=" + offset,
  );
  const [shared, setShared] = useState("");
  return (
    <div className="page search-page">
      <SnapshotNotice at={snapshotAt} />
      <Link className="back-link" to="/">
        ← A different brilliant idea
      </Link>
      <div className="results-header">
        <h1>
          {loading
            ? "Consulting the evidence…"
            : (data?.verdict ?? "A slight plot twist.")}
        </h1>
        <p className="query-display">“{q}”</p>
      </div>
      {loading && (
        <div className="loading-state" role="status">
          <span className="loading-bar" />
          Searching verified product descriptions and capabilities…
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <>
          <div className="results-toolbar">
            <p className="found-count">
              Found: <b>{data.total}</b> relevant{" "}
              {data.total === 1 ? "product" : "products"}.
            </p>
            <div className="match-counts">
              <span>
                <b>{data.summary.strong}</b> strong
              </span>
              <span>
                <b>{data.summary.partial}</b> partial
              </span>
              <span>
                <b>{data.summary.related}</b> related
              </span>
            </div>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setShared("Link copied.");
                } catch {
                  setShared("Copy the URL from your browser to share.");
                }
              }}
            >
              Share this reality check ↗
            </button>
            <span role="status">{shared}</span>
          </div>
          <p className="muted results-footnote">
            Counts cover this search’s bounded candidate set, up to 80 products.
            Capabilities without evidence are marked unverified.
          </p>
          <div className="results-list">
            {data.results.map((p, i) => (
              <ProductCard key={p.slug} product={p} index={offset + i} />
            ))}
          </div>
          {!data.total && (
            <div className="empty-state">
              <PixelArt kind="bulb" />
              <h2>
                Either you’re onto something,
                <br />
                or our database hasn’t caught up.
              </h2>
              <p>
                No credible match in the current catalog. That’s a coverage
                limit, not a patent search.
              </p>
            </div>
          )}
          {data.total > 20 && (
            <nav className="pagination" aria-label="Search pages">
              {offset > 0 && (
                <Link
                  to={
                    "/search?q=" +
                    encodeURIComponent(q) +
                    "&offset=" +
                    (offset - 20)
                  }
                >
                  ← Previous
                </Link>
              )}
              {offset + 20 < data.total && (
                <Link
                  to={
                    "/search?q=" +
                    encodeURIComponent(q) +
                    "&offset=" +
                    (offset + 20)
                  }
                >
                  More results →
                </Link>
              )}
            </nav>
          )}
          {data.summary.strong === 0 && (
            <aside className="fallback">
              <div>
                <h2>The internet is somewhat bigger than our catalog.</h2>
                <p>Try a wider search. You’ll leave this website.</p>
              </div>
              <a
                className="button secondary"
                href={
                  "https://www.google.com/search?q=" +
                  encodeURIComponent(q + " software")
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Search the web ↗
              </a>
            </aside>
          )}
          <div className="refinement">
            <h2>There’s always the pivot.</h2>
            <SearchForm key={q} initial={q} compact />
          </div>
        </>
      )}
      {error && <SearchForm initial={q} compact />}
    </div>
  );
}
