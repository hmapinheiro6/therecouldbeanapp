import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
type Choice = { slug: string; name: string };
type Overview = {
  published: { verification_scope: string; count: number }[];
  queue: { status: string; count: number }[];
  runs: {
    id: string;
    source_name: string;
    status: string;
    started_at: string;
    candidates_found: number;
    records_accepted: number;
    records_pending: number;
    error_summary: string | null;
  }[];
  categories: Choice[];
  capabilities: Choice[];
};
type Row = {
  id: string;
  name: string;
  canonical_url: string;
  source_name: string;
  source_url: string;
  status: string;
  reason: string | null;
  created_at: string;
  description?: string;
  review_draft_json?: string | null;
};
type Claim = {
  slug: string;
  evidence_url: string;
  evidence_text: string;
  verified_at?: string;
};
type Draft = {
  slug: string;
  name: string;
  canonical_url: string;
  short_description: string;
  category_slug: string;
  audience?: string;
  search_aliases?: string;
  verification_scope: "identity" | "capabilities";
  identity_evidence_url: string;
  identity_evidence_text: string;
  capabilities: Claim[];
};
async function request<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/admin" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const b = (await r.json()) as { error?: { message?: string } };
  if (!r.ok)
    throw new ApiError(
      b.error?.message ?? "The review request failed.",
      r.status,
    );
  return b as T;
}
export function Admin() {
  const selection = useRef<string | null>(null);
  const [slugLocked, setSlugLocked] = useState(false);
  const [signed, setSigned] = useState<boolean | null>(null),
    [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [overview, setOverview] = useState<Overview | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [kind, setKind] = useState("candidate"),
    [status, setStatus] = useState("needs_review"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [reason, setReason] = useState(""),
    [attested, setAttested] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    request("/session")
      .then(() => setSigned(true))
      .catch((e) => {
        setSigned(false);
        if (e instanceof ApiError && e.status >= 500) setError(e.message);
      });
  }, []);
  useEffect(() => {
    if (!signed) return;
    let active = true;
    Promise.all([
      request<Overview>("/overview"),
      request<{ records: Row[]; has_more: boolean }>(
        "/queue?" +
          new URLSearchParams({
            kind,
            status,
            offset: String(offset),
            q: search,
          }),
      ),
    ])
      .then(([o, q]) => {
        if (active) {
          setOverview(o);
          setRows(q.records);
          setMore(q.has_more);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [signed, kind, status, offset, search, message]);
  function open(row: Row) {
    selection.current = row.id;
    setSlugLocked(false);
    let saved: Partial<Draft> = {};
    try {
      saved = JSON.parse(row.review_draft_json ?? "{}");
    } catch {
      /* An invalid saved draft must not hide the source record. */
    }
    setSelected(row);
    setAttested(false);
    setReason("");
    setError("");
    setDraft({
      slug:
        row.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 75)
          .replace(/-$/, "") +
        "-" +
        row.id.slice(0, 8),
      name: row.name,
      canonical_url: row.canonical_url,
      short_description: row.description ?? "",
      category_slug: "desktop-apps",
      verification_scope: "identity",
      identity_evidence_url: row.canonical_url,
      identity_evidence_text: "",
      capabilities: [],
      ...saved,
    });
    void request<{ product: Partial<Draft> | null }>(
      "/draft?" + new URLSearchParams({ kind, id: row.id }),
    )
      .then(({ product }) => {
        if (product && selection.current === row.id) {
          setSlugLocked(true);
          setDraft((current) =>
            current
              ? row.review_draft_json
                ? { ...current, slug: product.slug ?? current.slug }
                : { ...current, ...product }
              : current,
          );
        }
      })
      .catch((e) => {
        if (selection.current === row.id) setError(e.message);
      });
  }
  async function act(action: string) {
    if (!selected || !draft) return;
    setBusy(true);
    setError("");
    try {
      await request("/review", {
        kind,
        id: selected.id,
        action,
        reason,
        attested,
        product: {
          ...draft,
          capabilities: draft.capabilities.map((c) => ({
            ...c,
            verified_at: new Date().toISOString(),
          })),
        },
      });
      setMessage(action + " completed at " + new Date().toLocaleTimeString());
      if (action !== "save") {
        setSelected(null);
        setDraft(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (signed === null)
    return (
      <div className="page" role="status">
        Checking your admin session…
      </div>
    );
  if (!signed)
    return (
      <div className="page admin-login">
        <Link to="/">← Back to search</Link>
        <h1 className="page-title">Catalog review</h1>
        <p className="page-intro">Private access for the site operator.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request("/login", { key });
              setKey("");
              setSigned(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="admin-key">Admin access key</label>
          <input
            id="admin-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <button className="button primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <p className="muted">
          Your access key is separate from the publishing credentials. Sessions
          expire after eight hours.
        </p>
      </div>
    );
  return (
    <div className="page admin-page">
      <div className="admin-heading">
        <h1 className="page-title">Catalog review</h1>
        <button
          className="text-button"
          onClick={async () => {
            await request("/logout", {});
            setSigned(false);
            setOverview(null);
            setRows([]);
            setDraft(null);
            setSelected(null);
          }}
        >
          Sign out
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="admin-stats">
        <p>
          <b>{overview?.published.reduce((n, p) => n + p.count, 0) ?? "…"}</b>{" "}
          published
        </p>
        <p>
          <b>
            {overview
              ? (overview.published.find(
                  (p) => p.verification_scope === "capabilities",
                )?.count ?? 0)
              : "…"}
          </b>{" "}
          with documented features
        </p>
        <p>
          <b>
            {overview
              ? (overview.queue.find((p) => p.status === "needs_review")
                  ?.count ?? 0)
              : "…"}
          </b>{" "}
          need review
        </p>
      </div>
      <div className="admin-filters">
        <label>
          Queue
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setStatus(
                e.target.value === "product"
                  ? "published"
                  : e.target.value === "submission"
                    ? "pending"
                    : "needs_review",
              );
              setOffset(0);
              setSelected(null);
              setDraft(null);
            }}
          >
            <option value="candidate">Discovered apps</option>
            <option value="submission">Founder submissions</option>
            <option value="product">Published catalog</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            {(kind === "product"
              ? ["published", "needs_review", "all"]
              : [
                  "needs_review",
                  "pending_verification",
                  "pending",
                  "approved",
                  "published",
                  "rejected",
                  "all",
                ]
            ).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Find an app
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <button
          className="text-button"
          onClick={() => setMessage("Refreshed " + Date.now())}
        >
          Refresh
        </button>
      </div>
      <div className="admin-columns">
        <section aria-label="Review queue" className="review-queue">
          {rows.map((row) => (
            <button
              className={
                "review-row " + (selected?.id === row.id ? "selected" : "")
              }
              key={row.id}
              onClick={() => open(row)}
            >
              <b>{row.name}</b>
              <span>{new URL(row.canonical_url).hostname}</span>
              <small>{row.reason ?? row.status}</small>
              <small>{row.source_name}</small>
            </button>
          ))}
          {!rows.length && (
            <p>
              {error
                ? "The review queue is unavailable while the database is paused."
                : "No records match this filter."}
            </p>
          )}
          <div className="pagination">
            <button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 30))}
            >
              ← Previous
            </button>
            <button disabled={!more} onClick={() => setOffset(offset + 30)}>
              Next →
            </button>
          </div>
        </section>
        <section className="review-editor" aria-label="App editor">
          {selected && draft ? (
            <>
              <h2>{selected.name}</h2>
              <p className="muted">{selected.reason}</p>
              <div className="review-source-links">
                <a
                  href={selected.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open official website ↗
                </a>
                <a
                  href={selected.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open discovery source ↗
                </a>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("publish");
                }}
              >
                <label>
                  Product name
                  <input
                    required
                    value={draft.name}
                    maxLength={100}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Public URL slug
                  <input
                    required
                    value={draft.slug}
                    readOnly={slugLocked}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    onChange={(e) =>
                      setDraft({ ...draft, slug: e.target.value })
                    }
                  />
                </label>
                <label>
                  Official website
                  <input
                    type="url"
                    required
                    value={draft.canonical_url}
                    onChange={(e) =>
                      setDraft({ ...draft, canonical_url: e.target.value })
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    required
                    minLength={20}
                    maxLength={600}
                    value={draft.short_description}
                    onChange={(e) =>
                      setDraft({ ...draft, short_description: e.target.value })
                    }
                  />
                </label>
                <label>
                  Category
                  <select
                    value={draft.category_slug}
                    onChange={(e) =>
                      setDraft({ ...draft, category_slug: e.target.value })
                    }
                  >
                    {overview?.categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Verification
                  <select
                    value={draft.verification_scope}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        verification_scope: e.target
                          .value as Draft["verification_scope"],
                      })
                    }
                  >
                    <option value="identity">
                      Official website checked; features not verified
                    </option>
                    <option value="capabilities">
                      Features documented in official sources
                    </option>
                  </select>
                </label>
                <label>
                  Official identity evidence URL
                  <input
                    type="url"
                    required
                    value={draft.identity_evidence_url}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        identity_evidence_url: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Official identity excerpt
                  <textarea
                    required
                    maxLength={600}
                    placeholder="A short title or excerpt confirming this product's identity"
                    value={draft.identity_evidence_text}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        identity_evidence_text: e.target.value,
                      })
                    }
                  />
                </label>
                <h3>Capability evidence</h3>
                <p className="muted">
                  Only add capabilities explicitly supported by the official
                  product page. Identity-only publication is available when
                  feature classification is incomplete.
                </p>
                {draft.capabilities.map((claim, i) => (
                  <fieldset key={i}>
                    <legend>Capability {i + 1}</legend>
                    <label>
                      Capability
                      <select
                        value={claim.slug}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            capabilities: draft.capabilities.map((c, j) =>
                              j === i ? { ...c, slug: e.target.value } : c,
                            ),
                          })
                        }
                      >
                        {overview?.capabilities.map((c) => (
                          <option key={c.slug} value={c.slug}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Evidence URL
                      <input
                        type="url"
                        required
                        value={claim.evidence_url}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            capabilities: draft.capabilities.map((c, j) =>
                              j === i
                                ? { ...c, evidence_url: e.target.value }
                                : c,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Exact supporting excerpt
                      <textarea
                        required
                        minLength={8}
                        maxLength={600}
                        value={claim.evidence_text}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            capabilities: draft.capabilities.map((c, j) =>
                              j === i
                                ? { ...c, evidence_text: e.target.value }
                                : c,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          capabilities: draft.capabilities.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                    >
                      Remove capability
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  className="text-button"
                  disabled={draft.capabilities.length >= 12}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      verification_scope: "capabilities",
                      capabilities: [
                        ...draft.capabilities,
                        {
                          slug: overview?.capabilities[0]?.slug ?? "",
                          evidence_url: draft.canonical_url,
                          evidence_text: "",
                        },
                      ],
                    })
                  }
                >
                  Add capability +
                </button>
                <label>
                  Review note
                  <textarea
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label className="review-attestation">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                  />
                  I checked the official website and the evidence entered above.
                </label>
                <div className="review-actions">
                  <button
                    className="button primary"
                    disabled={busy || !attested}
                  >
                    Approve and publish
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || reason.length < 3 || kind !== "candidate"}
                    onClick={() => void act("save")}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || reason.length < 3 || kind === "product"}
                    onClick={() => void act("retry")}
                  >
                    Retry automatically
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || reason.length < 3}
                    onClick={() => void act("reject")}
                  >
                    {kind === "product" ? "Unpublish" : "Reject"}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p>
              Select an app to inspect its source, correct details, and publish
              or reject it.
            </p>
          )}
        </section>
      </div>
      <section className="admin-runs">
        <h2>Discovery runs</h2>
        <p>
          Recent launches and licensed catalog backfill run separately. Counts
          are actual processed and accepted records; existing canonical URLs are
          deduplicated.
        </p>
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Started</th>
                <th>Status</th>
                <th>Processed</th>
                <th>Accepted</th>
                <th>Pending</th>
              </tr>
            </thead>
            <tbody>
              {overview?.runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.source_name}</td>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td>
                    {r.status}
                    {r.error_summary && <small>{r.error_summary}</small>}
                  </td>
                  <td>{r.candidates_found}</td>
                  <td>{r.records_accepted}</td>
                  <td>{r.records_pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
