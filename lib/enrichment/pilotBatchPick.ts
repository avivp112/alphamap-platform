/**
 * lib/enrichment/pilotBatchPick.ts — the companies of the next wet batch (owner, 2026-11-09): new ones (not in an earlier
 * batch), five, with at least one Israeli, one European and one American, and at least one thin and one data-rich.
 * Seeded, so the pick can be repeated. Pure.
 */
import { isThin, isIsraeli, type PilotCandidate } from "./pilotSample.ts";

const EUROPE = new Set(["united kingdom", "uk", "germany", "france", "netherlands", "spain", "italy", "sweden", "norway", "denmark", "finland", "ireland", "switzerland", "austria", "belgium", "portugal", "poland", "estonia", "lithuania", "latvia", "czech republic", "czechia", "greece", "romania", "hungary", "luxembourg", "ukraine", "bulgaria", "croatia", "serbia"]);
const country = (c: PilotCandidate) => (c.country ?? "").trim().toLowerCase();
export const isEuropean = (c: PilotCandidate) => EUROPE.has(country(c));
export const isAmerican = (c: PilotCandidate) => /^(united states|usa|us|united states of america)$/.test(country(c));
/** Data-rich: a real description and people on file. */
export const isRich = (c: PilotCandidate) => (c.description?.trim().length ?? 0) >= 200 && ((c.founders?.length ?? 0) > 0 || (c.leadership?.length ?? 0) > 0);

function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function pickBatch(rows: PilotCandidate[], opts: { size?: number; exclude: Set<string>; seed: number }): Array<PilotCandidate & { why: string[] }> {
  const size = opts.size ?? 5;
  // The mix scales with the batch: at least a fifth of it Israeli, European, American, thin and data-rich (one each at five).
  const per = Math.max(1, Math.floor(size / 5));
  const pool = shuffled(rows.filter((r) => r.website && !opts.exclude.has(r.id) && r.status !== "ipo"), opts.seed);
  const picked = new Map<string, PilotCandidate>();
  const take = (xs: PilotCandidate[], n = 1) => { for (const x of xs) { if (n <= 0 || picked.size >= size) break; if (!picked.has(x.id)) { picked.set(x.id, x); n--; } } };
  take(pool.filter(isIsraeli), per);
  take(pool.filter((c) => isEuropean(c) && !isIsraeli(c)), per);
  take(pool.filter((c) => isAmerican(c) && !isIsraeli(c)), per);
  take(pool.filter(isThin), Math.max(0, per - [...picked.values()].filter(isThin).length));
  take(pool.filter(isRich), Math.max(0, per - [...picked.values()].filter(isRich).length));
  take(pool, size - picked.size);
  return [...picked.values()].map((c) => ({ ...c, why: [isIsraeli(c) ? "israeli" : isEuropean(c) ? "european" : isAmerican(c) ? "american" : "other", isThin(c) ? "thin" : isRich(c) ? "rich" : "mid"] }));
}
