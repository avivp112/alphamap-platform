/**
 * lib/enrichment/pilotSample.ts — the draw of a partial wet run (owner,
 * 2026-11-01): random, with at least `minThin` companies small or thin on
 * data and at least `minIsraeli` Israeli ones (HQ or founded in Israel).
 * Seeded, so a draw can be repeated. Pure.
 */

export interface PilotCandidate {
  id: string; name: string; website: string | null; description: string | null;
  city: string | null; country: string | null; founded_year: number | null; founding_country: string | null; status?: string | null;
  founders?: unknown[] | null; competitors?: unknown[] | null;
}

/** Thin: no description, or neither a city nor a founded year on file. */
export const isThin = (c: PilotCandidate) => !c.description?.trim() || (!c.city && !c.founded_year);
export const isIsraeli = (c: PilotCandidate) => /^israel$/i.test(c.country ?? "") || /^israel$/i.test(c.founding_country ?? "");

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function drawPilotSample(rows: PilotCandidate[], opts: { size: number; minThin: number; minIsraeli: number; seed: number }): Array<PilotCandidate & { why: string[] }> {
  const pool = shuffled(rows.filter((r) => r.website), opts.seed);
  const picked = new Map<string, PilotCandidate>();
  const take = (xs: PilotCandidate[], n: number) => { for (const x of xs) { if (n <= 0 || picked.size >= opts.size) break; if (!picked.has(x.id)) { picked.set(x.id, x); n--; } } };
  take(pool.filter(isIsraeli), opts.minIsraeli);
  take(pool.filter((r) => isThin(r) && !picked.has(r.id)), Math.max(0, opts.minThin - [...picked.values()].filter(isThin).length));
  take(pool, opts.size - picked.size);
  return [...picked.values()].map((c) => ({ ...c, why: [isIsraeli(c) ? "israeli" : "", isThin(c) ? "thin" : ""].filter(Boolean).concat(isIsraeli(c) || isThin(c) ? [] : ["random"]) }));
}

/**
 * How many of the fields still short of marks a company would fill (owner, 2026-11-04): an empty
 * HQ, founded year, founding country, founders or competitors — the review shows a value only
 * where the field is empty on file.
 */
export function missingFieldCount(c: PilotCandidate): number {
  return [!c.city, !c.founded_year, !c.founding_country, !(c.founders ?? []).length, !(c.competitors ?? []).length].filter(Boolean).length;
}

/** The targeted share of a review run (owner, 2026-11-04): 8 of 15; of a larger run, under half. */
export const targetedCount = (size: number) => (size <= 15 ? Math.min(8, size) : Math.floor(size * 0.45));

/**
 * The review's draw (owner, 2026-11-04): `targeted` companies picked for the fields short of
 * marks — covered by an allowed press source (`covered`) and missing at least 3 of those fields,
 * most missing first — and the rest at random (drawPilotSample), so the precision measured
 * still reflects small companies.
 */
export function drawReviewSample(rows: PilotCandidate[], covered: Set<string>, opts: { size: number; targeted: number; seed: number }): Array<PilotCandidate & { why: string[] }> {
  const pool = shuffled(rows.filter((r) => r.website), opts.seed);
  const targeted = pool.filter((r) => covered.has(r.id) && missingFieldCount(r) >= 3)
    .sort((a, b) => missingFieldCount(b) - missingFieldCount(a))
    .slice(0, opts.targeted)
    .map((c) => ({ ...c, why: ["targeted"] }));
  const taken = new Set(targeted.map((t) => t.id));
  const random = drawPilotSample(pool.filter((r) => !taken.has(r.id)), { size: opts.size - targeted.length, minThin: 2, minIsraeli: 2, seed: opts.seed + 1 });
  return [...targeted, ...random];
}
