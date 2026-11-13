/**
 * How much v1 knows about a company (owner, 2026-11-13): the order of writing is the empty companies first, then the ones with v1 data.
 *
 * The five things counted: a description, a headquarters (city or country), a founded year, at least one funding round, at least one founder.
 *   empty    none of the five
 *   partial  one to four of them, or all five with a short description (under 200 characters)
 *   full     all five, with a description of 200 characters or more: a full v1 profile
 */
export type DataGroup = "empty" | "partial" | "full";

export interface GroupInput {
  description: string | null; city: string | null; country: string | null; founded_year: number | null;
  founders: unknown[] | null | undefined; rounds: number;
}

export function presentFields(c: GroupInput): string[] {
  const out: string[] = [];
  if (c.description?.trim()) out.push("description");
  if (c.city?.trim() || c.country?.trim()) out.push("headquarters");
  if (c.founded_year) out.push("founded_year");
  if (c.rounds > 0) out.push("rounds");
  if ((c.founders?.length ?? 0) > 0) out.push("founders");
  return out;
}

export function dataGroup(c: GroupInput): DataGroup {
  const have = presentFields(c);
  if (have.length === 0) return "empty";
  if (have.length === 5 && (c.description?.trim().length ?? 0) >= 200) return "full";
  return "partial";
}

/** The country signal an empty company still has: its website's top-level domain. generic = .com / .io / .ai … (no country). */
export type TldBucket = "israel" | "uk_ireland" | "europe" | "north_america" | "asia_pacific" | "latin_america" | "middle_east_africa" | "generic";
const BUCKETS: Array<[TldBucket, RegExp]> = [
  ["israel", /\.il$/], ["uk_ireland", /\.(uk|ie)$/],
  ["europe", /\.(de|fr|nl|es|it|se|no|dk|fi|ch|at|be|pt|pl|ee|lt|lv|cz|gr|ro|hu|lu|ua|bg|hr|rs|eu)$/],
  ["north_america", /\.(ca|us)$/], ["asia_pacific", /\.(in|jp|cn|sg|kr|au|nz|hk|tw|my|id|th|vn|ph)$/],
  ["latin_america", /\.(br|mx|ar|cl|co|pe|uy)$/], ["middle_east_africa", /\.(ae|sa|tr|eg|za|ng|ke|ma|qa|jo)$/],
];
export function tldBucket(website: string | null | undefined): TldBucket {
  let host = "";
  try { host = new URL(/^https?:/i.test(website ?? "") ? website! : `https://${website}`).hostname.toLowerCase(); } catch { return "generic"; }
  // ".co.uk" and ".com.au" end in a country code; ".co" alone is Colombia, but ".co" as a startup domain is mostly generic: not counted unless two-label.
  if (/\.co$/.test(host)) return "generic";
  for (const [b, re] of BUCKETS) if (re.test(host)) return b;
  return "generic";
}

/** A batch from one group, spread over the buckets: round-robin so no bucket fills it while others are empty. Seeded by the caller's order. */
export function spreadPick<T extends { id: string; website: string | null }>(pool: T[], size: number): Array<T & { bucket: TldBucket }> {
  const by = new Map<TldBucket, T[]>();
  for (const c of pool) { const b = tldBucket(c.website); by.set(b, [...(by.get(b) ?? []), c]); }
  const order = [...by.keys()].sort((a, b) => (a === "generic" ? 1 : 0) - (b === "generic" ? 1 : 0) || (by.get(a)!.length - by.get(b)!.length));
  const out: Array<T & { bucket: TldBucket }> = [];
  const idx = new Map<TldBucket, number>();
  while (out.length < size && order.some((b) => (idx.get(b) ?? 0) < by.get(b)!.length)) {
    for (const b of order) {
      if (out.length >= size) break;
      const i = idx.get(b) ?? 0;
      if (i < by.get(b)!.length) { out.push({ ...by.get(b)![i], bucket: b }); idx.set(b, i + 1); }
    }
  }
  return out;
}
