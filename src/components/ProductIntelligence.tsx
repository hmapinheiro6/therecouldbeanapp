import { useEffect, useRef, useState } from "react";
import {
  parseIntelligence,
  websiteLabel,
  observationDate,
  isStale,
  type ProductIntelligence as Intel,
  type IntelligenceFact,
} from "../lib/intelligence";
import type { Product } from "../lib/types";
const requests = new Map<string, Promise<Intel | null>>();
async function read(url: string, slug: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("Content-Length") ?? 0) > 32768
    )
      return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return parseIntelligence(JSON.parse(new TextDecoder().decode(data)), slug);
  } catch {
    return null;
  }
}
function load(slug: string) {
  if (!requests.has(slug)) {
    if (requests.size >= 128) requests.delete(requests.keys().next().value!);
    requests.set(
      slug,
      (async () => {
        const bundled = await read(
          "/catalog-intelligence/" + slug + ".json",
          slug,
        );
        if (bundled && Date.now() - Date.parse(bundled.checked_at) < 86400_000)
          return bundled;
        return (await read("/api/intelligence/" + slug, slug)) ?? bundled;
      })(),
    );
  }
  return requests.get(slug)!;
}
function useObservation(product: Product, compact: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{
    slug: string;
    data: Intel | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    function retrieve() {
      void load(product.slug).then((data) => {
        if (active)
          setResult({
            slug: product.slug,
            data:
              data &&
              data.canonical_url.replace(/\/$/, "") ===
                product.canonical_url.replace(/\/$/, "")
                ? data
                : null,
          });
      });
    }
    const observer =
      compact && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((e) => e.isIntersecting)) {
                observer?.disconnect();
                retrieve();
              }
            },
            { rootMargin: "250px" },
          )
        : null;
    if (observer && ref.current) observer.observe(ref.current);
    else retrieve();
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [product.slug, product.canonical_url, compact]);
  return {
    ref,
    data: result?.slug === product.slug ? result.data : null,
    loading: result?.slug !== product.slug,
  };
}
function Source({ fact }: { fact: IntelligenceFact }) {
  return (
    <small>
      <a href={fact.source_url} target="_blank" rel="noopener noreferrer">
        Source ↗
      </a>{" "}
      · observed {observationDate(fact.observed_at)}
    </small>
  );
}
const eventLabels: Record<string, string> = {
  publication: "Publisher publication date",
  publisher_update: "Publisher update date",
  version: "Publisher version",
  changelog_entry: "Dated changelog entry",
  repository_created: "Repository created",
  repository_archived: "Repository archived",
  earliest_release: "Earliest release found",
  latest_release: "Latest release found",
};
const stateLabels: Record<string, string> = {
  reachable: "Website reachable",
  restricted: "Automated check restricted",
  unreachable: "Website unreachable at check",
  identity_unconfirmed: "Website identity unconfirmed",
  unknown: "Website status unknown",
};
export function ProductIntelligence({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const { ref, data: p, loading } = useObservation(product, compact);
  if (compact)
    return (
      <div ref={ref} className="card-observation">
        {p && (
          <span className={"observation-state state-" + p.website.state}>
            {isStale(p) ? "Older observation: " : ""}
            {websiteLabel(p)} <span>· {observationDate(p.checked_at)}</span>
          </span>
        )}
      </div>
    );
  if (!p)
    return (
      <section
        ref={ref}
        className="product-intelligence intelligence-empty"
        aria-label="Product intelligence"
      >
        <h2>Product intelligence</h2>
        <p className="muted">
          {loading
            ? "Loading public observations…"
            : "Not yet checked by our scheduled observation job. Product age and current website status are unknown."}
        </p>
      </section>
    );
  const f = p.facts;
  const age = f.publication ?? f.earliest_release;
  const updates = [
    f.latest_release && { fact: f.latest_release, label: "Public release" },
    f.changelog_entry && {
      fact: f.changelog_entry,
      label: "Dated changelog entry",
    },
    f.publisher_update && {
      fact: f.publisher_update,
      label: "Publisher update date",
    },
  ]
    .filter((v): v is { fact: IntelligenceFact; label: string } => !!v)
    .sort((a, b) => (b.fact.date ?? "").localeCompare(a.fact.date ?? ""));
  const latest = updates[0];
  const years = age?.date
    ? Math.floor((Date.now() - Date.parse(age.date)) / (365.2425 * 86400_000))
    : 0;
  return (
    <section
      ref={ref}
      className="product-intelligence"
      aria-labelledby="intelligence-title"
    >
      <h2 id="intelligence-title">Product intelligence</h2>
      <p className="muted intelligence-explainer">
        Dated public evidence. Website checks are occasional observations; they
        do not measure application uptime.
      </p>
      {isStale(p) && (
        <p className="notice">
          This website observation is over 14 days old. Current availability is
          unknown.
        </p>
      )}
      <div className="intelligence-grid">
        <div className="intelligence-fact">
          <h3>Website</h3>
          <p className={"observation-state state-" + p.website.state}>
            {websiteLabel(p)}
          </p>
          <small>
            Checked {observationDate(p.checked_at)} ·{" "}
            <a
              href={p.website.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Website ↗
            </a>
          </small>
          {p.website.state === "unreachable" && (
            <p className="muted">
              Unreachable on {p.website.failed_observation_days} observed{" "}
              {p.website.failed_observation_days === 1 ? "day" : "days"}. This
              does not establish that the product has closed.
            </p>
          )}
          {p.website.state === "restricted" && (
            <p className="muted">
              The site restricted our automated request. Its availability is
              undetermined.
            </p>
          )}
          {p.website.last_reachable_at && p.website.state !== "reachable" && (
            <small>
              Last reachable {observationDate(p.website.last_reachable_at)}
            </small>
          )}
        </div>
        <div className="intelligence-fact">
          <h3>Public history</h3>
          {age?.date ? (
            <>
              <p>
                {f.publication
                  ? "Publisher publication date"
                  : "Public release evidence"}
                <br />
                <strong>{observationDate(age.date)}</strong>
              </p>
              {!f.publication && years >= 1 && (
                <p className="muted">
                  Public evidence spanning at least {years}{" "}
                  {years === 1 ? "year" : "years"}.
                </p>
              )}
              <Source fact={age} />
              <p className="muted">
                {f.publication
                  ? "Date reported by the publisher; not independently verified as a launch date."
                  : "Earliest public release found. Continuous operation is not established."}
              </p>
            </>
          ) : (
            <>
              <p>Product age unknown</p>
              <p className="muted">
                No supported publication or release date found yet.
              </p>
            </>
          )}
          {f.repository_created?.date && (
            <p className="repository-date">
              Repository created {observationDate(f.repository_created.date)}
              <Source fact={f.repository_created} />
              <span className="muted">
                Repository age is separate from product launch.
              </span>
            </p>
          )}
        </div>
        <div className="intelligence-fact">
          <h3>Latest documented update</h3>
          {latest?.fact.date ? (
            <>
              <p>
                {latest.label}
                <br />
                <strong>{observationDate(latest.fact.date)}</strong>
              </p>
              <Source fact={latest.fact} />
            </>
          ) : (
            <p>No dated update found yet</p>
          )}
          {f.version && (
            <p>
              Publisher version: {String(f.version.value)}
              <Source fact={f.version} />
            </p>
          )}
          {f.latest_release?.value && (
            <p>Release: {String(f.latest_release.value)}</p>
          )}
          {f.repository_archived?.value === true && (
            <p className="notice">
              The linked repository is archived. This alone does not establish
              that the product has closed.
              <Source fact={f.repository_archived} />
            </p>
          )}
        </div>
      </div>
      <details className="observation-history">
        <summary>Observation history ({p.history.length})</summary>
        <p className="muted">
          Changes we observed, not a complete product history. We retain up to
          32 changes and 56 daily website observations.
        </p>
        <ol>
          {[...p.history].reverse().map((event, i) => (
            <li key={event.observed_at + event.kind + i}>
              <time dateTime={event.observed_at}>
                {observationDate(event.observed_at)}
              </time>
              <span>
                {event.kind === "website"
                  ? (stateLabels[event.value] ?? "Website status unknown")
                  : `${eventLabels[event.kind]}: ${event.kind === "repository_archived" ? (event.value.toLowerCase() === "true" ? "yes" : "no") : event.value}`}
              </span>
              <a
                href={event.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Source ↗
              </a>
            </li>
          ))}
        </ol>
        <p className="muted">
          First observation: {observationDate(p.first_observed_at)}. Scheduled
          enrichment:{" "}
          {p.enriched_at ? observationDate(p.enriched_at) : "not yet run"}.
        </p>
      </details>
    </section>
  );
}
