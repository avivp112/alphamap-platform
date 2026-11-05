/**
 * lib/enrichment/pilotSample.ts — the draw of a partial wet run (owner,
 * 2026-11-01): random, with at least `minThin` companies small or thin on
 * data and at least `minIsraeli` Israeli ones (HQ or founded in Israel).
 * Seeded, so a draw can be repeated. Pure.
 */

export interface PilotCandidate {
  id: string; name: string; website: string | null; description: string | null;
  city: string | null; country: string | null; founded_year: number | null; founding_country: string | null; status?: string | null;
  founders?: unknown[] | null; competitors?: unknown[] | null; leadership?: unknown[] | null; patents?: unknown[] | null;
  /** Rounds on file (funding_rounds), when counted. */
  rounds_on_file?: number;
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
 * The fields a review run can be pointed at (FOCUS=competitors,rounds,…), each with whether the
 * company is short of it: empty on file, so a value found would be one the review can mark.
 */
export const FOCUS_FIELDS: Record<string, (c: PilotCandidate) => boolean> = {
  hq: (c) => !c.city, city: (c) => !c.city, founded_year: (c) => !c.founded_year, founding_country: (c) => !c.founding_country,
  founders: (c) => !(c.founders ?? []).length, founder: (c) => !(c.founders ?? []).length,
  competitors: (c) => !(c.competitors ?? []).length, competitor: (c) => !(c.competitors ?? []).length,
  leadership: (c) => !(c.leadership ?? []).length, leader: (c) => !(c.leadership ?? []).length,
  patents: (c) => !(c.patents ?? []).length, patent: (c) => !(c.patents ?? []).length,
  rounds: (c) => (c.rounds_on_file ?? 0) < 2, round: (c) => (c.rounds_on_file ?? 0) < 2,
};
const DEFAULT_FOCUS = ["city", "founded_year", "founding_country", "founders", "competitors"];

/** How many of the focused fields (default: HQ, founded year, founding country, founders, competitors) the company is short of. */
export function missingFieldCount(c: PilotCandidate, focus: readonly string[] = DEFAULT_FOCUS): number {
  return focus.filter((f) => FOCUS_FIELDS[f]?.(c)).length;
}

/** The targeted share of a review run (owner, 2026-11-04): 8 of 15; of a larger run, under half. */
export const targetedCount = (size: number) => (size <= 15 ? Math.min(8, size) : Math.floor(size * 0.45));

/**
 * The review's draw (owner, 2026-11-04): `targeted` companies picked for the fields short of
 * marks — covered by an allowed press source (`covered`) and missing at least 3 of those fields,
 * most missing first — and the rest at random (drawPilotSample), so the precision measured
 * still reflects small companies.
 */
export function drawReviewSample(rows: PilotCandidate[], covered: Set<string>, opts: { size: number; targeted: number; seed: number; focus?: readonly string[] }): Array<PilotCandidate & { why: string[] }> {
  const pool = shuffled(rows.filter((r) => r.website), opts.seed);
  // A run pointed at fields (FOCUS) takes any company short of one of them; the default needs three.
  const focus = opts.focus?.length ? opts.focus : DEFAULT_FOCUS;
  const need = opts.focus?.length ? 1 : 3;
  const targeted = pool.filter((r) => covered.has(r.id) && missingFieldCount(r, focus) >= need)
    .sort((a, b) => missingFieldCount(b, focus) - missingFieldCount(a, focus))
    .slice(0, opts.targeted)
    .map((c) => ({ ...c, why: ["targeted"] }));
  const taken = new Set(targeted.map((t) => t.id));
  const random = drawPilotSample(pool.filter((r) => !taken.has(r.id)), { size: opts.size - targeted.length, minThin: 2, minIsraeli: 2, seed: opts.seed + 1 });
  return [...targeted, ...random];
}
