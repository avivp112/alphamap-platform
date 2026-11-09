/**
 * eval/searchAudit.ts — where a run's search money went (owner, 2026-11-05: search is ~60% of the
 * cost). Pure: reads the search log each company's output carries (a run made after 2026-11-05).
 * Per query label: calls paid, cache hits, share of the paid calls and of the cost; per company:
 * queries that repeat another (the same words in another order, or one inside the other).
 */
import type { PipelineOutput } from "./score.ts";

/** calls = paid + cached: a run answered from the cache still shows what a fresh run would pay. */
export interface LabelRow { label: string; paid: number; cached: number; calls: number; share: number; cost_usd: number }
export interface AuditResult { labels: LabelRow[]; paid: number; cached: number; calls: number; cost_usd: number; companies: number; withoutLog: number; repeats: Array<{ company: string; a: string; b: string; labels: [string, string] }> }

const tokens = (q: string) => new Set(q.toLowerCase().replace(/site:\S+/g, " ").replace(/\b(or|and)\b/g, " ").split(/[^a-z0-9]+/).filter((t) => t.length > 2));
/** Share of the smaller query's words that the other also has (1 = one is inside the other). */
export function overlap(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const t of x) if (y.has(t)) n++;
  return n / Math.min(x.size, y.size);
}

export function auditSearches(perCompany: Record<string, { output: Pick<PipelineOutput, "search_log"> | null }>, names: Record<string, string> = {}, costPerCall = 0.001, repeatAt = 0.85): AuditResult {
  const byLabel = new Map<string, { paid: number; cached: number }>();
  const repeats: AuditResult["repeats"] = [];
  let withoutLog = 0, companies = 0;
  for (const [id, c] of Object.entries(perCompany)) {
    const log = c.output?.search_log;
    if (!log) { withoutLog++; continue; }
    companies++;
    for (const q of log) {
      const e = byLabel.get(q.label) ?? { paid: 0, cached: 0 };
      if (q.cached) e.cached++; else e.paid++;
      byLabel.set(q.label, e);
    }
    const distinct = [...new Map(log.map((q) => [q.query, q])).values()];
    for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
      if (overlap(distinct[i].query, distinct[j].query) >= repeatAt) repeats.push({ company: names[id] ?? id, a: distinct[i].query, b: distinct[j].query, labels: [distinct[i].label, distinct[j].label] });
    }
  }
  const paid = [...byLabel.values()].reduce((n, e) => n + e.paid, 0);
  const cached = [...byLabel.values()].reduce((n, e) => n + e.cached, 0);
  const calls = paid + cached;
  const labels = [...byLabel].map(([label, e]) => ({ label, paid: e.paid, cached: e.cached, calls: e.paid + e.cached, share: calls ? (e.paid + e.cached) / calls : 0, cost_usd: (e.paid + e.cached) * costPerCall })).sort((a, b) => b.calls - a.calls);
  return { labels, paid, cached, calls, cost_usd: calls * costPerCall, companies, withoutLog, repeats };
}

export function auditText(a: AuditResult): string {
  if (!a.companies) return `No company carries a search log (${a.withoutLog} without). The log is written by runs made after 2026-11-05: run the evaluation once more.`;
  const lines = [`${a.companies} companies · ${a.calls} searches = $${a.cost_usd.toFixed(3)} at fresh prices ($${(a.cost_usd / a.companies).toFixed(4)} per company) · of them ${a.cached} answered from the cache, ${a.paid} paid`, "", "label                      calls  cached  share   fresh cost"];
  for (const l of a.labels) lines.push(`${l.label.padEnd(26)}${String(l.calls).padStart(5)}  ${String(l.cached).padStart(6)}  ${`${(l.share * 100).toFixed(0)}%`.padStart(5)}  $${l.cost_usd.toFixed(3)}`);
  lines.push("", `Queries that repeat another of the same company (word overlap ≥ 85%): ${a.repeats.length}`);
  for (const r of a.repeats.slice(0, 15)) lines.push(`  ${r.company}: [${r.labels[0]}] ${r.a.slice(0, 70)}  ≈  [${r.labels[1]}] ${r.b.slice(0, 70)}`);
  if (a.withoutLog) lines.push("", `${a.withoutLog} companies carry no log (older run) and are not counted.`);
  return lines.join("\n");
}
