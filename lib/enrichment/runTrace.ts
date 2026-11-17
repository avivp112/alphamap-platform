/**
 * lib/enrichment/runTrace.ts — what each company's run did beyond the fixed list (owner, round 10, batch 6): which searches in the company's own language ran and what they returned, and how
 * many pages the sitemap offered and were read. Printed as a table at the end of the run.
 */
export interface CompanyTrace {
  lang?: string | null;
  /** label → number of results of the local-language searches */
  local?: Record<string, number>;
  sitemap?: { found: number; read: number } | null;
}
const T = new Map<string, CompanyTrace>();
export const traceOf = (company: string): CompanyTrace => { let t = T.get(company); if (!t) { t = {}; T.set(company, t); } return t; };

export function traceTable(): string {
  if (!T.size) return "";
  const rows = [...T].map(([c, t]) => {
    const local = t.lang ? `${t.lang}: ${Object.entries(t.local ?? {}).map(([k, n]) => `${k.replace(/_local$/, "")} ${n}`).join(", ") || "no result"}` : "— (no local language)";
    const sm = t.sitemap ? `${t.sitemap.found} offered, ${t.sitemap.read} page(s) read` : "no sitemap";
    return `  ${c.padEnd(24).slice(0, 24)} | ${local.padEnd(58).slice(0, 58)} | ${sm}`;
  });
  return `Local-language searches and sitemap, per company\n  ${"company".padEnd(24)} | ${"language: results per search".padEnd(58)} | sitemap\n${rows.join("\n")}`;
}
