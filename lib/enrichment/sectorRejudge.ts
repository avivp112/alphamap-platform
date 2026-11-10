/**
 * lib/enrichment/sectorRejudge.ts — the sector marks counted against the CURRENT classification (owner, 2026-11-10).
 * The replay drops a mark whose value the current rules no longer produce. The sector is produced by a model reading the
 * verified description (classifySector.ts), so "produced" means: classify the description the mark's company had, and see
 * whether the same sector comes out. A mark whose company has no stored description cannot be judged and stays.
 */
import type { Mark } from "./fieldReview.ts";

export interface Rejudged { id: string; produced: boolean; now: string }

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** "Parent › Sub" — a mark that names only the parent is judged on the parent. */
export function sameSector(markValue: string, now: string): boolean {
  const [mp, ms] = markValue.split("›").map((x) => norm(x));
  const [np, ns] = now.split("›").map((x) => norm(x));
  return mp === np && (!ms || ms === ns);
}

export async function rejudgeSectorMarks(
  marks: Array<Pick<Mark, "id" | "field" | "company" | "value">>,
  descriptionOf: (company: string) => string | null,
  classify: (company: string, description: string) => Promise<string | null>,
): Promise<Rejudged[]> {
  const out: Rejudged[] = [];
  const cache = new Map<string, string | null>();
  for (const m of marks.filter((x) => x.field === "sector")) {
    const d = descriptionOf(m.company);
    if (!d) continue;
    if (!cache.has(m.company)) cache.set(m.company, await classify(m.company, d));
    const now = cache.get(m.company);
    if (!now) continue;
    out.push({ id: m.id, produced: sameSector(m.value, now), now });
  }
  return out;
}

/** The replay's judgements with the classification's: a rule that already rejects a mark stays; otherwise the classification decides. */
export function applySectorRejudge(judged: Map<string, { produced: boolean; rule?: string }>, rows: Rejudged[]): void {
  for (const r of rows) {
    const j = judged.get(r.id);
    if (j && j.produced && !r.produced) judged.set(r.id, { produced: false, rule: `the current classification gives ${r.now}` });
  }
}
