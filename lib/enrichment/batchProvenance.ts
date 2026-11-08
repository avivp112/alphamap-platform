/**
 * lib/enrichment/batchProvenance.ts — does every value a wet batch wrote have its source on file? (owner, 2026-11-08)
 * The batch CSV numbers the values (batchReport.ts); the database holds one field_provenance row per value written —
 * a scalar field as "profile.city", a competitor as "market.competitors", a round as "funding_rounds.<id>.<column>",
 * and a news item, founder, leader or patent as "news.<title>", "founders.<name>", "leadership.<name>",
 * "patents.<number>". This pairs each numbered value with its row, by the run that wrote it. Pure.
 */
export interface BatchRow { id: string; field: string; company: string; company_id: string; value: string; source_url?: string }
export interface ProvRow { startup_id: string; field: string; source_url: string | null; run_id: string | null }
export type ProvStatus = "ok" | "missing" | "no_source" | "not_written_in_pilot";
export interface ProvCheck { id: string; field: string; company: string; value: string; status: ProvStatus; source_url: string | null; expects: string }

const SCALAR: Record<string, string> = {
  hq_city: "profile.city", hq_country: "profile.country", founded_year: "profile.founded_year", founding_country: "profile.founding_country",
  office: "profile.offices", employee_range: "metrics.employee_range", employee_count: "metrics.employee_count",
  competitor_declared: "market.competitors", competitor_market: "market.competitors", competitor: "market.competitors",
};
const head = (value: string) => value.split(" — ")[0].split(":")[0].trim();

/** The field_provenance field a numbered value is expected under: exact, or a prefix ending in "." / a round's "funding_rounds.". */
export function expectedProvenance(r: Pick<BatchRow, "field" | "value">): { exact?: string; prefix?: string } | null {
  if (SCALAR[r.field]) return { exact: SCALAR[r.field] };
  switch (r.field) {
    case "round": return { prefix: "funding_rounds." };
    case "news": return { exact: `news.${r.value.split(" — ").slice(1).join(" — ").slice(0, 120)}` };
    case "leader": return { exact: `leadership.${head(r.value)}` };
    case "founder": case "founder_bio": return { exact: `founders.${head(r.value)}` };
    case "patent": return { exact: `patents.${r.value.split(" ")[0]}` };
    default: return null;
  }
}

export function checkBatchProvenance(values: BatchRow[], prov: ProvRow[]): ProvCheck[] {
  // A round batch value is covered when the run wrote a provenance row for a distinct round of that company, one each.
  const roundsLeft = new Map<string, Set<string>>();
  for (const p of prov) {
    const m = p.field.match(/^funding_rounds\.([^.]+)\./);
    if (m) roundsLeft.set(p.startup_id, (roundsLeft.get(p.startup_id) ?? new Set()).add(m[1]));
  }
  const used = new Map<string, number>();
  return values.map((v): ProvCheck => {
    const base = { id: v.id, field: v.field, company: v.company, value: v.value };
    const exp = expectedProvenance(v);
    if (!exp) return { ...base, status: "not_written_in_pilot", source_url: null, expects: "—" };
    if (exp.prefix) {
      const rows = prov.filter((p) => p.startup_id === v.company_id && p.field.startsWith(exp.prefix!));
      const n = used.get(v.company_id) ?? 0;
      const have = roundsLeft.get(v.company_id)?.size ?? 0;
      used.set(v.company_id, n + 1);
      if (n >= have) return { ...base, status: "missing", source_url: null, expects: `${exp.prefix}<round id>.*` };
      const url = rows.find((r) => r.source_url)?.source_url ?? null;
      return { ...base, status: url ? "ok" : "no_source", source_url: url, expects: `${exp.prefix}<round id>.*` };
    }
    const hit = prov.find((p) => p.startup_id === v.company_id && p.field === exp.exact);
    if (!hit) return { ...base, status: "missing", source_url: null, expects: exp.exact! };
    return { ...base, status: hit.source_url ? "ok" : "no_source", source_url: hit.source_url, expects: exp.exact! };
  });
}

export function renderProvenanceReport(checks: ProvCheck[], runId: string): string {
  const mark = { ok: "✓", missing: "✗ NO PROVENANCE ROW", no_source: "✗ ROW WITHOUT A SOURCE URL", not_written_in_pilot: "– not a pilot field" } as const;
  const lines = [`Provenance of run ${runId}: ${checks.filter((c) => c.status === "ok").length} of ${checks.length} value(s) have their source on file`, ""];
  for (const c of checks) lines.push(`  ${c.id.padEnd(7)} ${mark[c.status].padEnd(28)} ${c.field.padEnd(20)} ${c.company}: ${c.value.slice(0, 70)}${c.source_url ? `\n          ↳ ${c.source_url}` : ""}`);
  const bad = checks.filter((c) => c.status === "missing" || c.status === "no_source");
  lines.push("", bad.length ? `⛔ ${bad.length} value(s) without provenance — undo the run before going on: RUN_ID=${runId} DRY_RUN=false npx tsx scripts/undo_run.ts` : "✅ every value written has its source on file.");
  return lines.join("\n");
}
