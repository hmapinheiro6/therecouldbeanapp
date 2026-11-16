/** Publisher metadata is presentation, never evidence for search ranking or features. */
export interface ProductPreview {
  version: 1;
  slug: string;
  canonical_url: string;
  source_url: string;
  checked_at: string;
  title: string;
  description: string;
  image: null | {
    data: string;
    width: number;
    height: number;
    kind: "og:image" | "twitter:image" | "icon";
    source_url: string;
    alt: string;
  };
}
const https = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
};
const plain = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  value.length <= limit &&
  !/[<>]/.test(value) &&
  !Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
export function validPreview(
  value: unknown,
  slug: string,
): value is ProductPreview {
  if (!value || typeof value !== "object") return false;
  const p = value as ProductPreview;
  if (
    p.version !== 1 ||
    p.slug !== slug ||
    !https(p.canonical_url) ||
    !https(p.source_url) ||
    !plain(p.title, 160) ||
    !plain(p.description, 280) ||
    typeof p.checked_at !== "string" ||
    p.checked_at.length > 40 ||
    !Number.isFinite(Date.parse(p.checked_at))
  )
    return false;
  if (
    new URL(p.canonical_url).hostname.replace(/^www\./, "") !==
    new URL(p.source_url).hostname.replace(/^www\./, "")
  )
    return false;
  const image = p.image;
  return (
    image === null ||
    (!!image &&
      ["og:image", "twitter:image", "icon"].includes(image.kind) &&
      https(image.source_url) &&
      plain(image.alt, 160) &&
      Number.isInteger(image.width) &&
      Number.isInteger(image.height) &&
      image.width > 0 &&
      image.width <= 480 &&
      image.height > 0 &&
      image.height <= 300 &&
      typeof image.data === "string" &&
      image.data.length <= 32791 &&
      /^data:image\/webp;base64,UklGR[A-Za-z0-9+/]+={0,2}$/.test(image.data))
  );
}
export function publicPreview(p: ProductPreview): ProductPreview {
  return {
    version: 1,
    slug: p.slug,
    canonical_url: p.canonical_url,
    source_url: p.source_url,
    checked_at: p.checked_at,
    title: p.title,
    description: p.description,
    image: p.image
      ? {
          data: p.image.data,
          width: p.image.width,
          height: p.image.height,
          kind: p.image.kind,
          source_url: p.image.source_url,
          alt: p.image.alt,
        }
      : null,
  };
}
