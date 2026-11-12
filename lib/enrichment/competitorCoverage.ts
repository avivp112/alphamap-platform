/**
 * The competitor coverage of a review run (owner, 2026-11-12): how many of the collected companies have 0, 1–2 or 3+ competitors, declared and
 * market together and apart. The aim: 3 or more for at least half of the companies.
 */
export interface CompetitorLists { onFile: Array<{ name?: string; tier?: string; unverified?: boolean }>; found: Array<{ name: string; tier?: string }> }
export interface Coverage { companies: number; zero: number; oneTwo: number; threePlus: number }
export const COVERAGE_TARGET_SHARE = 0.5;

/** Distinct competitor names of a company by tier; "declared" is the tier of an entry that names none. */
export function competitorCounts(c: CompetitorLists): { declared: number; market: number; all: number } {
  const seen = new Map<string, "declared" | "market">();
  for (const x of [...c.onFile.filter((o) => !o.unverified), ...c.found]) {
    const name = (x.name ?? "").trim().toLowerCase();
    if (!name) continue;
    const tier = x.tier === "market" ? "market" : "declared";
    // The same name found under both tiers counts once, as declared (the stronger).
    if (!seen.has(name) || tier === "declared") seen.set(name, tier);
  }
  const tiers = [...seen.values()];
  return { declared: tiers.filter((t) => t === "declared").length, market: tiers.filter((t) => t === "market").length, all: tiers.length };
}

const bucket = (counts: number[]): Coverage => ({ companies: counts.length, zero: counts.filter((n) => n === 0).length, oneTwo: counts.filter((n) => n === 1 || n === 2).length, threePlus: counts.filter((n) => n >= 3).length });

export function coverageOf(list: CompetitorLists[]): { all: Coverage; declared: Coverage; market: Coverage; targetMet: boolean } {
  const counts = list.map(competitorCounts);
  const all = bucket(counts.map((c) => c.all));
  return { all, declared: bucket(counts.map((c) => c.declared)), market: bucket(counts.map((c) => c.market)), targetMet: all.companies > 0 && all.threePlus / all.companies >= COVERAGE_TARGET_SHARE };
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");
export function coverageReport(list: CompetitorLists[]): string[] {
  const r = coverageOf(list);
  const line = (label: string, c: Coverage) => `  ${label.padEnd(14)} 0: ${c.zero} (${pct(c.zero, c.companies)}) · 1–2: ${c.oneTwo} (${pct(c.oneTwo, c.companies)}) · 3+: ${c.threePlus} (${pct(c.threePlus, c.companies)})`;
  return [
    `Competitor coverage — ${r.all.companies} companies collected (on file + found this run, verified only):`,
    line("declared + market", r.all), line("declared", r.declared), line("market", r.market),
    `  Aim: 3+ competitors for at least ${COVERAGE_TARGET_SHARE * 100}% of the companies — ${r.targetMet ? "✅ met" : `❌ ${pct(r.all.threePlus, r.all.companies)} so far`}`,
  ];
}
