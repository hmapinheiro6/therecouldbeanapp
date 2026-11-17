export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const isRead = !options?.method || options.method === "GET";
  const url = new URL(path, "https://catalog.invalid");
  const recentPage =
    isRead &&
    url.pathname === "/products" &&
    url.searchParams.get("sort") === "recent" &&
    !(url.searchParams.get("category") ?? "") &&
    (url.searchParams.get("offset") ?? "0") === "0";
  if (isRead && !recentPage && /^\/(search|products)(?:[/?]|$)/.test(path)) {
    // A product page includes its own public record for a small first load.
    const embedded = document.getElementById("catalog-product");
    if (embedded && path.startsWith("/products/")) {
      const product = JSON.parse(embedded.textContent ?? "null");
      if (product?.slug === decodeURIComponent(path.slice(10)))
        return product as T;
    }
    const { catalogApi } = await import("./static-catalog");
    return (await catalogApi(path, options?.signal ?? undefined)) as T;
  }
  const staticPath =
    isRead && ["/stats", "/categories", "/config"].includes(path);
  const response = await fetch(
    recentPage
      ? "/catalog/recent.json"
      : staticPath
        ? "/catalog" + path + ".json"
        : "/api" + path,
    options,
  );
  let data: { error?: { message?: string; code?: string } };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new ApiError(
      "The catalog is temporarily unavailable. Please try again later.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? "Something went wrong. Please try again.",
      response.status,
    );
  return data as T;
}
