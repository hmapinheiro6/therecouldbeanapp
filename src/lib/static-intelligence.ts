import { parseIntelligence, type ProductIntelligence } from "./intelligence";
export function intelligenceBucket(slug: string) {
  let hash = 2166136261;
  for (const c of slug) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash & 255).toString(16).padStart(2, "0");
}
const buckets = new Map<string, Promise<Record<string, unknown>>>();
export async function loadIntelligence(
  slug: string,
): Promise<ProductIntelligence | null> {
  const bucket = intelligenceBucket(slug);
  if (!buckets.has(bucket)) {
    if (buckets.size >= 16) buckets.delete(buckets.keys().next().value!);
    buckets.set(
      bucket,
      fetch("/catalog/intelligence/" + bucket + ".json")
        .then(async (r) => {
          if (!r.ok) throw new Error("Observation file unavailable");
          const text = await r.text();
          if (text.length > 4 * 1024 * 1024)
            throw new Error("Observation file too large");
          return JSON.parse(text) as Record<string, unknown>;
        })
        .catch((e) => {
          buckets.delete(bucket);
          throw e;
        }),
    );
  }
  try {
    return parseIntelligence((await buckets.get(bucket)!)[slug], slug);
  } catch {
    return null;
  }
}
