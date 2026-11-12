/**
 * lib/enrichment/sectorRejudge.ts — the sector marks counted against the CURRENT classification (owner, 2026-11-10).
 * The replay drops a mark whose value the current rules no longer produce. The sector is produced by a model reading the
 * verified description (classifySector.ts), so "produced" means: classify the description the mark's company had, and see
 * whether the same sector comes out. A mark whose company has no stored description cannot be judged and stays.
 */
import type { Mark, RejudgedRow } from "./fieldReview.ts";

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

/**
 * The tracker rows for the new classifications nobody has marked yet: wrong for the old ids named, correct for the rest. Run again after
 * the classifier changes once more, only the values still without a mark get one; the id carries the round (rj.<old id>, rj2.<old id>, …).
 */
export function marksForNewClassifications(
  rows: RejudgedRow[], marks: Array<Pick<Mark, "id" | "field" | "company" | "value" | "source_url">>,
  wrongOldIds: string[], sourceOf: (company: string) => string | undefined, note: string,
): { marks: Mark[]; unknown: string[] } {
  const sector = marks.filter((m) => m.field === "sector");
  const byId = new Map(sector.map((m) => [m.id, m]));
  const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
  const changed = rows.filter((r) => !r.produced && r.now && byId.has(r.id))
    .filter((r) => !sector.some((m) => m.company === byId.get(r.id)!.company && norm(m.value) === norm(r.now)));
  const round = 1 + Math.max(0, ...marks.map((m) => Number(m.id.match(/^rj(\d*)\./)?.[1] || (m.id.startsWith("rj.") ? 1 : 0))));
  const prefix = round === 1 ? "rj" : `rj${round}`;
  const out: Mark[] = changed.map((r) => {
    const old = byId.get(r.id)!;
    return { id: `${prefix}.${r.id}`, field: "sector", company: old.company, value: r.now, source_url: sourceOf(old.company) ?? old.source_url, verdict: wrongOldIds.includes(r.id) ? "wrong" : "correct", source_of_mark: note };
  });
  const known = new Set(changed.map((r) => r.id));
  return { marks: out, unknown: wrongOldIds.filter((w) => !known.has(w)) };
}
