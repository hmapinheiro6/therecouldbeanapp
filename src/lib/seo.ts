import type { Product } from "./types";

export const SITE_NAME = "There Could Be An App";
export const INDEX_ROBOTS =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
export const PAGE_METADATA: Record<
  string,
  { title: string; description: string }
> = {
  "/": {
    title: "Find Apps & Software for Your Idea — There Could Be An App",
    description:
      "Describe your app idea and find existing software, SaaS, desktop apps and self-hosted tools. Compare documented features with evidence from official sources.",
  },
  "/explore": {
    title: "Explore Apps & Software by Category — There Could Be An App",
    description:
      "Browse apps, SaaS, desktop software and self-hosted tools by category. Every listing includes official website checks and clear feature verification details.",
  },
  "/about": {
    title: "How We Find and Verify Software — There Could Be An App",
    description:
      "Learn how There Could Be An App discovers software, checks official websites and ranks documented capabilities. Understand our sources and verification limits.",
  },
  "/submit": {
    title: "Submit Your App to the Software Catalog — There Could Be An App",
    description:
      "Submit your software for independent identity checks and catalog inclusion. No account or payment required; feature evidence is verified separately.",
  },
  "/privacy": {
    title: "Privacy — There Could Be An App",
    description:
      "What we process, what we keep, and how spam protection works.",
  },
  "/terms": {
    title: "Terms — There Could Be An App",
    description: "Terms for researching software and submitting a product.",
  },
  "/search": {
    title: "Search Results — There Could Be An App",
    description:
      "Find relevant software for your app idea and compare source-backed capabilities.",
  },
  "/admin": {
    title: "Catalog Review — There Could Be An App",
    description: "Private catalog review.",
  },
};

export type SeoCategory = { slug: string; name: string; product_count: number };

export function catalogPath(category = "", page = 1) {
  const path = category ? `/categories/${category}` : "/explore";
  return page > 1 ? `${path}/page/${page}` : path;
}

export function catalogRoute(pathname: string) {
  const match = pathname.match(
    /^\/(?:explore|categories\/([a-z0-9-]+))(?:\/page\/([1-9]\d*))?$/,
  );
  return match
    ? { category: match[1] ?? "", page: Number(match[2] ?? 1) }
    : null;
}

export function pageMetadata(
  pathname: string,
  product?: Product,
  category?: SeoCategory,
) {
  const path = pathname.replace(/\/$/, "") || "/";
  if (product)
    return {
      title: `${product.name}: ${product.category} Software — ${SITE_NAME}`,
      description: `${product.short_description} ${product.verification_scope === "identity" ? "Official website checked; features not verified." : "Explore features documented with official-source evidence."}`,
      robots: INDEX_ROBOTS,
    };
  const route = catalogRoute(path);
  if (route && (!route.category || category))
    return {
      title: `${category ? `${category.name} Apps & Software` : "Explore Apps & Software by Category"}${route.page > 1 ? ` — Page ${route.page}` : ""} — ${SITE_NAME}`,
      description: category
        ? `Browse ${category.product_count} ${category.name.toLowerCase()} listings${route.page > 1 ? `, page ${route.page}` : ""}. Compare descriptions, official websites, sources and feature verification details.`
        : `${PAGE_METADATA["/explore"].description}${route.page > 1 ? ` Page ${route.page}.` : ""}`,
      robots: INDEX_ROBOTS,
    };
  const known = PAGE_METADATA[path];
  return {
    ...(known ?? {
      title: `Page Not Found — ${SITE_NAME}`,
      description:
        "This page is not in the software catalog. Browse the catalog to find existing apps and software.",
    }),
    robots:
      !known || path === "/search" || path === "/admin"
        ? "noindex,nofollow"
        : INDEX_ROBOTS,
  };
}

export function pageStructuredData(
  base: string,
  path: string,
  meta: { title: string; description: string },
  product?: Product,
  category?: SeoCategory,
  items?: Product[],
) {
  const url = base + path;
  const website = {
    "@type": "WebSite",
    "@id": base + "/#website",
    url: base + "/",
    name: SITE_NAME,
    description: PAGE_METADATA["/"].description,
    inLanguage: "en",
  };
  const breadcrumbs = [{ name: "Home", item: base + "/" }];
  const route = catalogRoute(path);
  if (product || route)
    breadcrumbs.push({ name: "Explore software", item: base + "/explore" });
  const breadcrumbCategory =
    category ??
    (product
      ? { slug: product.category_slug, name: product.category }
      : undefined);
  if (breadcrumbCategory)
    breadcrumbs.push({
      name: breadcrumbCategory.name,
      item: base + catalogPath(breadcrumbCategory.slug),
    });
  if (product) breadcrumbs.push({ name: product.name, item: url });
  else if (route && route.page > 1)
    breadcrumbs.push({ name: `Page ${route.page}`, item: url });
  else if (path !== "/" && !route)
    breadcrumbs.push({ name: meta.title.split(" — ")[0], item: url });
  const page = {
    "@type": items
      ? "CollectionPage"
      : path === "/about"
        ? "AboutPage"
        : "WebPage",
    "@id": url + "#webpage",
    url,
    name: meta.title,
    description: meta.description,
    inLanguage: "en",
    isPartOf: { "@id": website["@id"] },
    ...(product
      ? {
          mainEntity: { "@id": url + "#software" },
          citation: (product.sources ?? []).map((s) => s.source_url),
        }
      : {}),
    ...(items
      ? {
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: items.length,
            itemListElement: items.map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: p.name,
              url: base + "/apps/" + p.slug,
            })),
          },
        }
      : {}),
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      website,
      page,
      ...(breadcrumbs.length > 1
        ? [
            {
              "@type": "BreadcrumbList",
              "@id": url + "#breadcrumbs",
              itemListElement: breadcrumbs.map((b, i) => ({
                "@type": "ListItem",
                position: i + 1,
                ...b,
              })),
            },
          ]
        : []),
      ...(product
        ? [
            {
              "@type": "SoftwareApplication",
              "@id": url + "#software",
              name: product.name,
              url: product.canonical_url,
              description: product.short_description,
              applicationCategory: product.category,
              mainEntityOfPage: { "@id": page["@id"] },
              ...(product.capabilities.length
                ? { featureList: product.capabilities.map((c) => c.name) }
                : {}),
            },
          ]
        : []),
    ],
  };
}

export function updatePageMetadata(
  base: string,
  path: string,
  product?: Product,
  category?: SeoCategory,
  items?: Product[],
  notFound = false,
) {
  const meta = notFound
    ? pageMetadata("/404")
    : pageMetadata(path, product, category);
  document.title = meta.title;
  const setMeta = (key: string, content: string, property = false) => {
    const attr = property ? "property" : "name";
    let tag = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute(attr, key);
      document.head.appendChild(tag);
    }
    tag.content = content;
  };
  setMeta("description", meta.description);
  setMeta("robots", meta.robots);
  for (const prefix of ["og:", "twitter:"]) {
    setMeta(prefix + "title", meta.title, prefix === "og:");
    setMeta(prefix + "description", meta.description, prefix === "og:");
    setMeta(prefix + "image", base + "/social.png", prefix === "og:");
  }
  setMeta("og:url", base + path, true);
  let canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = base + path;
  let structured = document.getElementById("page-schema");
  if (!structured) {
    structured = document.createElement("script");
    structured.id = "page-schema";
    structured.setAttribute("type", "application/ld+json");
    document.head.appendChild(structured);
  }
  structured.textContent = JSON.stringify(
    pageStructuredData(base, path, meta, product, category, items),
  );
}

export function canonicalOrigin() {
  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  return canonical ? new URL(canonical.href).origin : window.location.origin;
}
