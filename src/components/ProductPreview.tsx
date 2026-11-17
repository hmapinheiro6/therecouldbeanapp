import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  publicPreview,
  validPreview,
  type ProductPreview as Preview,
} from "../lib/previews";
import type { Product } from "../lib/types";
let knownPreviews: Promise<Set<string>> | undefined;
function previewCatalog() {
  knownPreviews ??= fetch("/catalog/previews.json")
    .then(async (r) => {
      if (!r.ok) throw new Error("Preview manifest unavailable");
      const value = (await r.json()) as { slugs: string[] };
      return new Set(value.slugs);
    })
    .catch((e) => {
      knownPreviews = undefined;
      throw e;
    });
  return knownPreviews;
}
const requests = new Map<string, Promise<Preview | null>>();
async function read(url: string, slug: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (
      !response.ok ||
      response.status === 204 ||
      Number(response.headers.get("Content-Length") ?? 0) > 48 * 1024
    )
      return null;
    const value: unknown = await response.json();
    return validPreview(value, slug) &&
      (value.title || value.description || value.image)
      ? publicPreview(value)
      : null;
  } catch {
    return null;
  }
}
function load(slug: string) {
  if (!requests.has(slug)) {
    if (requests.size >= 128) requests.delete(requests.keys().next().value!);
    requests.set(
      slug,
      previewCatalog()
        .then((known) =>
          known.has(slug)
            ? read(
                "/catalog-previews/" + encodeURIComponent(slug) + ".json",
                slug,
              )
            : null,
        )
        .catch(() => null),
    );
  }
  return requests.get(slug)!;
}

export function ProductPreview({
  product,
  onMetadata,
}: {
  product: Product;
  onMetadata?: (preview: Preview) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ slug: string; data: Preview } | null>(
    null,
  );
  const [broken, setBroken] = useState(false);
  const callback = useRef(onMetadata);
  useEffect(() => {
    callback.current = onMetadata;
  }, [onMetadata]);
  useEffect(() => {
    let active = true;
    const target = container.current;
    if (!target) return;
    function retrieve() {
      void load(product.slug).then((data) => {
        if (
          !active ||
          !data ||
          data.canonical_url.replace(/\/$/, "") !==
            product.canonical_url.replace(/\/$/, "")
        )
          return;
        setLoaded({ slug: product.slug, data });
        callback.current?.(data);
      });
    }
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer?.disconnect();
                retrieve();
              }
            },
            { rootMargin: "250px" },
          )
        : null;
    if (observer) observer.observe(target);
    else retrieve();
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [product.slug, product.canonical_url]);
  const preview = loaded?.slug === product.slug ? loaded.data : null;
  const image = preview?.image;
  return (
    <div
      ref={container}
      className={
        "product-preview " +
        (image && !broken ? "has-image " : "") +
        (image?.kind === "icon" ? "is-logo" : "")
      }
    >
      <Link
        to={"/apps/" + product.slug}
        tabIndex={-1}
        aria-hidden="true"
        className="preview-link"
      >
        {image && !broken ? (
          <img
            src={image.data}
            width={image.width}
            height={image.height}
            alt=""
            decoding="async"
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="preview-fallback">
            <span>{product.name.slice(0, 1)}</span>
            <span>{product.name}</span>
          </div>
        )}
      </Link>
      {image && !broken && (
        <span className="preview-caption">
          {image.kind === "icon" ? "Publisher icon" : "Website preview"}
        </span>
      )}
    </div>
  );
}
