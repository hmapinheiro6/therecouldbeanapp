import { useState } from "react";
import { Link } from "react-router-dom";
import { Turnstile } from "../components/Turnstile";
import { useApi } from "../useApi";
import { api } from "../lib/api";
export function Submit() {
  const config = useApi<{
    turnstile_site_key: string;
    submissions_enabled: boolean;
  }>("/config");
  const categories = useApi<{ categories: { slug: string; name: string }[] }>(
    "/categories",
  );
  const [token, setToken] = useState(""),
    [reset, setReset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      status: string;
      message?: string;
      product?: { slug: string; name: string };
    } | null>(null);
  return (
    <div className="page submission-page">
      <span className="eyebrow">INTAKE DESK / NEW INVENTION</span>
      <h1 className="page-title">
        Built another app?
        <br />
        <em>Of course you did.</em>
      </h1>
      <p className="page-intro">
        File it in the invention archive. No account, payment,
        <br className="desktop-break" /> or founder origin story required.
      </p>
      {result ? (
        <div className="success-state" role="status">
          <h2>
            {result.status === "exists"
              ? "Beat you to it."
              : "Submission received."}
          </h2>
          <p>{result.message}</p>
          {result.product && (
            <Link to={"/apps/" + result.product.slug}>
              See {result.product.name} →
            </Link>
          )}
          <button
            className="text-button"
            onClick={() => {
              setResult(null);
              setToken("");
              setReset((n) => n + 1);
            }}
          >
            Submit another app →
          </button>
        </div>
      ) : (
        <form
          className="submission-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            const values = Object.fromEntries(new FormData(e.currentTarget));
            try {
              const data = await api<{
                status: string;
                message?: string;
                product?: { slug: string; name: string };
              }>("/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...values, turnstile_token: token }),
              });
              setResult(data);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
              setToken("");
              setReset((n) => n + 1);
            }
          }}
        >
          <label>
            Product name{" "}
            <input
              name="product_name"
              required
              minLength={2}
              maxLength={100}
              placeholder="Something ending in .ai, perhaps"
              autoComplete="organization"
            />
          </label>
          <label>
            Official website{" "}
            <input
              name="submitted_url"
              type="url"
              required
              maxLength={2000}
              placeholder="https://your-actual-app.com"
            />
          </label>
          <label>
            What does it do?{" "}
            <textarea
              name="description"
              rows={4}
              required
              minLength={20}
              maxLength={600}
              placeholder="The useful part. In 20–600 characters."
            />
          </label>
          <div className="form-row">
            <label>
              Category <small>optional</small>
              <select name="category_hint">
                <option value="">Choose a category</option>
                {categories.data?.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Contact email <small>optional</small>
              <input
                name="contact_email"
                type="email"
                maxLength={254}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
          </div>
          <p className="muted">
            Your email is private, used only for this submission, and removed
            after 30 days. We independently verify every product before
            publishing.
          </p>
          <label className="honeypot" aria-hidden="true">
            Leave empty
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          {config.data?.submissions_enabled &&
          config.data.turnstile_site_key ? (
            <Turnstile
              siteKey={config.data.turnstile_site_key}
              onToken={setToken}
              resetKey={reset}
            />
          ) : (
            <p className="notice" role="status">
              {config.loading
                ? "Loading verification…"
                : "Submissions are temporarily unavailable while verification is configured."}
            </p>
          )}
          <p role="alert" className="field-error">
            {error}
          </p>
          <div className="submit-bottom">
            <p>
              By submitting, you agree to our <Link to="/terms">terms</Link>
              <br />
              and <Link to="/privacy">privacy policy</Link>.
            </p>
            <button
              className="button primary"
              type="submit"
              disabled={busy || !token || !config.data?.submissions_enabled}
            >
              {busy ? "Checking…" : "Submit my app"} ↗
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
