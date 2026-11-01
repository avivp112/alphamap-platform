/**
 * lib/enrichment/pilotSample.ts — the draw of a partial wet run (owner,
 * 2026-11-01): random, with at least `minThin` companies small or thin on
 * data and at least `minIsraeli` Israeli ones (HQ or founded in Israel).
 * Seeded, so a draw can be repeated. Pure.
 */

export interface PilotCandidate {
  id: string; name: string; website: string | null; description: string | null;
  city: string | null; country: string | null; founded_year: number | null; founding_country: string | null; status?: string | null;
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
