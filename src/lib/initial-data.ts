import { createContext } from "react";

// Build-time rendering receives only the sanitized, published catalog.
export const InitialData = createContext<((path: string) => unknown) | null>(
  null,
);

let embedded:
  { pathname: string; responses: Record<string, unknown> } | null | undefined;
export function initialData(path: string) {
  if (typeof document === "undefined") return undefined;
  if (path.startsWith("/products/")) {
    try {
      const product = JSON.parse(
        document.getElementById("catalog-product")?.textContent ?? "null",
      );
      if (product?.slug === decodeURIComponent(path.slice(10))) return product;
    } catch {
      /* Fetch the current public record instead. */
    }
  }
  if (embedded === undefined) {
    try {
      embedded = JSON.parse(
        document.getElementById("catalog-page")?.textContent ?? "null",
      );
    } catch {
      embedded = null;
    }
  }
  if (
    !window.location.search &&
    embedded?.pathname === (window.location.pathname.replace(/\/$/, "") || "/")
  )
    return embedded.responses[path];
  return undefined;
}
