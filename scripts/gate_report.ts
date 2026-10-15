/**
 * Quality-gate dry run over everything already ingested — READ ONLY.
 *
 * Runs supabase/functions/_shared/company-gate.ts over every raw_gov_filings
 * row (UK Companies House, EPO, SEC Form D) and reports what each record would
 * have become: reject / queue (review only) / alert (review + user alert).
 * Also, per company those filings created, whether it is already described or
 * enriched — the rows the cleanup has to handle with care.
 *
 *   npx tsx scripts/gate_report.ts            # summary to the terminal
 *                                             # + gate_report.csv, one row per filing
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env, like the
 * enrichment scripts). Writes nothing to the database.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFileSync } from "fs";
import { pathToFileURL } from "url";
import {
  gateUkCompany, gateFormD, gatePatentApplicant, type GateResult, type GateTier,
} from "../supabase/functions/_shared/company-gate.ts";

export interface FilingRow {
  source: string;
  entity_name: string;
  form_type: string | null;
  classification_codes: string[] | null;
  officers: Array<{ name?: string; relationships?: string[] }> | null;
  industry_group: string | null;
  startup_id: string | null;
  startups: { description: string | null; last_enriched_at: string | null; enriched_v2_at: string | null } | null;
}

export function gateFiling(f: FilingRow, excluded: Set<string>): GateResult {
  switch (f.source) {
    case "uk_companies_house":
      return gateUkCompany({ name: f.entity_name, sicCodes: f.classification_codes ?? [], companyType: f.form_type, officers: f.officers });
    case "sec_form_d":
      return gateFormD({ name: f.entity_name, industryGroup: f.industry_group });
    case "epo_ops":
    case "uspto_patent":
      return gatePatentApplicant({ name: f.entity_name, excluded: excluded.has(f.entity_name) });
    default:
      return { tier: "reject", reasons: [`unknown_source:${f.source}`] };
  }
}

const RANK: Record<GateTier, number> = { reject: 0, queue: 1, alert: 2 };

/** A company created from several filings (one per patent) keeps its best verdict. */
export function companyTiers(rows: Array<{ startup_id: string | null; result: GateResult }>): Map<string, GateTier> {
  const out = new Map<string, GateTier>();
  for (const r of rows) {
    if (!r.startup_id) continue;
    const prev = out.get(r.startup_id);
    if (!prev || RANK[r.result.tier] > RANK[prev]) out.set(r.startup_id, r.result.tier);
  }
  return out;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  config();
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[k]) { console.error(`✗ ${k} is not set (.env)`); process.exit(1); }
  }
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const rows: FilingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("raw_gov_filings")
      .select("source, entity_name, form_type, classification_codes, officers, industry_group, startup_id, startups(description, last_enriched_at, enriched_v2_at)")
      .in("source", ["uk_companies_house", "epo_ops", "uspto_patent", "sec_form_d"])
      .order("ingested_at")
      .range(from, from + 999);
    if (error) { console.error(`✗ read raw_gov_filings: ${error.message}`); process.exit(1); }
    rows.push(...((data ?? []) as unknown as FilingRow[]));
    if (!data || data.length < 1000) break;
  }

  // Patent applicants on the denylist — the database's own matcher, in batches.
  const excluded = new Set<string>();
  const applicants = [...new Set(rows.filter((r) => r.source === "epo_ops" || r.source === "uspto_patent").map((r) => r.entity_name))];
  for (let i = 0; i < applicants.length; i += 500) {
    const { data, error } = await supabase.rpc("filter_excluded_applicants", { p_names: applicants.slice(i, i + 500) });
    if (error) { console.error(`✗ filter_excluded_applicants: ${error.message}`); process.exit(1); }
    for (const r of (data ?? []) as Array<{ name: string }>) excluded.add(r.name);
  }

  const gated = rows.map((f) => ({ ...f, result: gateFiling(f, excluded) }));

  console.log(`\n📋 Quality gate — dry run over ${rows.length} filings (nothing is written)\n`);
  for (const source of [...new Set(gated.map((g) => g.source))].sort()) {
    const g = gated.filter((x) => x.source === source);
    const by = (t: GateTier) => g.filter((x) => x.result.tier === t).length;
    console.log(`── ${source}: ${g.length} filings → alert ${by("alert")} · queue ${by("queue")} · reject ${by("reject")}`);
    const reasons = new Map<string, number>();
    for (const x of g) for (const r of x.result.reasons) {
      const key = r.split(":")[0] === "blocked_sic" || r.split(":")[0] === "name" || r.split(":")[0] === "vehicle_name" ? r : r.split(":")[0];
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`     ${String(n).padStart(4)}  ${r}`);
    const passed = g.filter((x) => x.result.tier !== "reject").map((x) => x.entity_name);
    if (passed.length) console.log(`   passes (${passed.length}): ${[...new Set(passed)].slice(0, 40).join(" · ")}${passed.length > 40 ? " …" : ""}`);
    console.log("");
  }

  // Companies already created from these filings — what the cleanup inherits.
  const tiers = companyTiers(gated);
  const companies = new Map<string, FilingRow>();
  for (const g of gated) if (g.startup_id && !companies.has(g.startup_id)) companies.set(g.startup_id, g);
  const count = (t: GateTier, pred: (f: FilingRow) => boolean) =>
    [...companies].filter(([id, f]) => tiers.get(id) === t && pred(f)).length;
  const described = (f: FilingRow) => !!f.startups?.description;
  const enriched = (f: FilingRow) => !!(f.startups?.last_enriched_at || f.startups?.enriched_v2_at);
  console.log(`🏢 Companies created from these filings: ${companies.size}`);
  for (const t of ["reject", "queue", "alert"] as GateTier[]) {
    console.log(`   ${t.padEnd(6)} ${String(count(t, () => true)).padStart(4)}   (with description ${count(t, described)}, enriched ${count(t, enriched)})`);
  }

  const header = ["source", "entity_name", "tier", "reasons", "startup_id", "has_description", "enriched", "codes", "directors_or_inventors", "company_type", "industry_group"];
  const lines = gated.map((g) => [
    g.source, g.entity_name, g.result.tier, g.result.reasons.join("; "), g.startup_id ?? "",
    described(g) ? 1 : 0, enriched(g) ? 1 : 0, (g.classification_codes ?? []).join(" "),
    (g.officers ?? []).length, g.form_type ?? "", g.industry_group ?? "",
  ].map(csvCell).join(","));
  writeFileSync("gate_report.csv", [header.join(","), ...lines].join("\n") + "\n");
  console.log(`\n📄 gate_report.csv — ${gated.length} rows, one per filing\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
