#!/usr/bin/env node
/**
 * scripts/batch_measure.ts — the measurement of a dry run (owner, 2026-11-24). READS the batch's files only.
 * Cost and time (total and per company), coverage per core field (companies with a value / enriched companies, against batch 9 when its summary is there), and 25 random values of the core fields
 * with their source and quote (the sample is seeded by the batch number, so it can be drawn again).  BATCH_NO=10 npx tsx scripts/batch_measure.ts
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { CORE_FIELDS } from "../lib/enrichment/tiers.ts";
import { rng } from "../lib/enrichment/audit.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const REPORT = process.env.REPORT ?? "pilot_report_dry.csv";
if (!existsSync(REPORT)) { console.error(`${REPORT} is missing`); process.exit(2); }
const [h, ...b] = parseCsv(readFileSync(REPORT, "utf8").replace(/^﻿/, ""));
const ix = (c: string) => h.indexOf(c);
const rows = b.map((r) => ({ company_id: r[ix("company_id")] ?? "", company: r[ix("company")] ?? "", field: r[ix("field")] ?? "", value: r[ix("after")] ?? "", source_url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "" })).filter((r) => r.company_id && r.field && r.field !== "(nothing)");
const enriched = new Set(rows.map((r) => r.company_id));

const summary = (n: number) => {
  const f = `batch_${n}_summary.md`; if (!existsSync(f)) return null;
  const t = readFileSync(f, "utf8");
  return { companies: Number(t.match(/companies in the batch: (\d+)/)?.[1] ?? 0), enriched: Number(t.match(/enriched \(with values in the report\): (\d+)/)?.[1] ?? 0), minutes: Number(t.match(/time ([\d.]+) min/)?.[1] ?? 0), cost: Number(t.match(/model cost \$([\d.]+)/)?.[1] ?? 0) };
};
const now = summary(batch), prev = summary(9);
if (now) {
  console.log(`batch ${batch}: ${now.companies} compan(ies), ${now.enriched} enriched`);
  console.log(`  model cost $${now.cost.toFixed(2)} → $${(now.cost / Math.max(now.companies, 1)).toFixed(4)} a company${prev ? `   (batch 9: $${(prev.cost / Math.max(prev.companies, 1)).toFixed(4)})` : ""}`);
  console.log(`  time ${now.minutes} min → ${(now.minutes / Math.max(now.companies, 1)).toFixed(2)} min a company${prev ? `   (batch 9: ${(prev.minutes / Math.max(prev.companies, 1)).toFixed(2)})` : ""}`);
  console.log("  (the cost is the model's; Serper and Jina searches are not in it: about $0.001 a search)");
}
console.log(`\ncoverage of the core fields — companies with a value / ${enriched.size} enriched compan(ies):`);
for (const f of CORE_FIELDS) {
  const n = new Set(rows.filter((r) => r.field === f).map((r) => r.company_id)).size;
  console.log(`  ${f.padEnd(28)} ${String(n).padStart(4)}  ${enriched.size ? ((100 * n) / enriched.size).toFixed(0).padStart(3) : "  0"}%`);
}
const core = rows.filter((r) => CORE_FIELDS.includes(r.field));
const rand = rng(batch * 7919 + 17);
const pool = core.slice(), pick: typeof core = [];
while (pick.length < 25 && pool.length) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(`measure_sample_${batch}.csv`, "﻿" + [["n", "company", "field", "value", "source_url", "quote", "verdict"].join(","), ...pick.map((x, i) => [i + 1, x.company, x.field, x.value, x.source_url, x.quote.slice(0, 300), ""].map((v) => q(String(v))).join(","))].join("\r\n") + "\r\n");
console.log(`\nsample: ${pick.length} random value(s) of ${core.length} core value(s) → measure_sample_${batch}.csv\n`);
pick.forEach((x, i) => console.log(`${String(i + 1).padStart(2)}. ${x.company} · ${x.field}: ${x.value.slice(0, 110)}\n     ${x.source_url}\n     "${x.quote.replace(/\s+/g, " ").slice(0, 200)}"`));
