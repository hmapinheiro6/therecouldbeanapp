import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../useApi";
import type { Product as ProductType } from "../lib/types";
import { SnapshotNotice } from "../components/SnapshotNotice";
const date = (v: string) =>
  new Date(v).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
export function Product() {
  const { slug } = useParams();
  const {
    data: p,
    error,
    loading,
    snapshotAt,
  } = useApi<ProductType>("/products/" + encodeURIComponent(slug ?? ""));
  useEffect(() => {
    if (p) {
      document.title = p.name + " — There Could Be An App";
      const description = document.querySelector('meta[name="description"]');
      description?.setAttribute("content", p.short_description);
    }
  }, [p]);
  if (loading)
    return (
      <div className="page" role="status">
        Opening the file…
      </div>
    );
  if (error || !p)
    return (
      <div className="page">
        <h1 className="page-title">This one got away.</h1>
        <p role="alert">{error}</p>
        <Link to="/explore">Back to the catalog →</Link>
      </div>
    );
  return (
    <div className="page product-detail">
      <SnapshotNotice at={snapshotAt} />
      <Link className="back-link" to="/explore">
        ← The invention archive
      </Link>
      <div className="detail-header">
        <div>
          <h1 className="page-title">{p.name}</h1>
          <p className="page-intro">{p.short_description}</p>
        </div>
        <a
          className="button primary"
          href={p.canonical_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit website ↗
        </a>
      </div>
      <div className="detail-columns">
        <section>
          {p.verification_scope === "identity" && (
            <div className="notice">
              <h2>Official identity checked</h2>
              <p>
                The official website confirms this product. Its capabilities
                have not yet been independently classified. The description is
                attributed to the discovery source below.
              </p>
              <p>“{p.identity_evidence_text}”</p>
              <a
                href={p.identity_evidence_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Official identity evidence ↗
              </a>
            </div>
          )}
          {p.capabilities.length > 0 && (
            <>
              <h2>What it actually does.</h2>
              <p className="muted">
                Capabilities supported by the official website. A source check
                is not a hands-on product review.
              </p>
              <div className="evidence-list">
                {p.capabilities.map((c) => (
                  <article key={c.slug}>
                    <h3>
                      <span aria-hidden="true">✓</span> {c.name}
                    </h3>
                    <p>“{c.evidence_text}”</p>
                    <a
                      href={c.evidence_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Official evidence ↗
                    </a>
                    <small>Checked {date(c.verified_at)}</small>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
        <aside className="product-facts">
          <dl>
            <dt>Official website</dt>
            <dd>
              <a
                href={p.canonical_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {p.normalized_domain} ↗
              </a>
            </dd>
            <dt>Category</dt>
            <dd>{p.category}</dd>
            {p.audience && (
              <>
                <dt>Audience</dt>
                <dd>{p.audience}</dd>
              </>
            )}
            <dt>First seen in our catalog</dt>
            <dd>{date(p.first_seen_at)}</dd>
            <dt>Last checked</dt>
            <dd>{date(p.last_verified_at)}</dd>
            {p.announced_at && (
              <>
                <dt>Confirmed announcement</dt>
                <dd>{date(p.announced_at)}</dd>
              </>
            )}
          </dl>
          <h3>Sources</h3>
          {p.sources?.map((s, i) => (
            <a
              key={i}
              className="source-link"
              href={s.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.source_name} ↗
            </a>
          ))}
          <p className="muted">
            First seen means when we discovered it. It is not a launch date.
            Availability and features may change.
          </p>
        </aside>
      </div>
    </div>
  );
}
