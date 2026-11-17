import type { Bindings } from "./security";
export const PRIVATE_ROUTES = [
  "/api/admin/*",
  "/api/internal/*",
  "/api/submit",
];
export function blockedRoutes(slugs: string[]) {
  if (
    slugs.length > 45 ||
    slugs.some((s) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) || s.length > 92)
  )
    throw new Error(
      "Urgent route list exceeds Cloudflare limits; complete the static rebuild first",
    );
  return [
    ...PRIVATE_ROUTES,
    ...slugs.flatMap((s) => ["/apps/" + s, "/apps/" + s + "/"]),
  ];
}
export function blockedPage(env: Bindings, slug: string) {
  const values = JSON.parse(env.STATIC_BLOCKED_SLUGS ?? "[]") as string[];
  return values.includes(slug);
}
