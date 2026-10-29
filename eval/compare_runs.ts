#!/usr/bin/env node
/**
 * eval/compare_runs.ts — two eval runs side by side (owner, 2026-10-29): the
 * core v2 with every component off, and v2 with every component on
 * (lib/enrichment/components.ts). Prints each field's precision and coverage
 * in both, the Phase 1 rules, cost, and per company what changed — rounds,
 * founders, city/country — so a component's gain or harm can be seen.
 *
 *   npx tsx eval/compare_runs.ts eval/v2_results_baseline.json eval/v2_results_all.json
 */

import { readFileSync } from "fs";

interface Run {
  settings?: { components?: Record<string, boolean> };
  fields: Record<string, { coverage: string; precision: string; wrong_write_rate: string; scored: number }>;
  phase1: Array<{ rule: string; pass: boolean; detail: string }>;
  cost?: { total_usd: number; per_company_usd: number; seconds_per_company: number };
  per_company: Record<string, {
    output: { city: string | null; country: string | null; founders: Array<{ name: string }>; rounds: Array<{ round_type: string; amount_raised: number | null; date: string | null }> } | null;
    fields?: Record<string, string>;
  }>;
}

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) { console.error("Usage: npx tsx eval/compare_runs.ts <run A.json> <run B.json>"); process.exit(1); }
const a = JSON.parse(readFileSync(aPath, "utf8")) as Run;
const b = JSON.parse(readFileSync(bPath, "utf8")) as Run;

const usd = (n: number | null) => (n == null ? "?" : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : `$${+(n / 1e6).toFixed(1)}M`);
const roundKey = (r: { round_type: string; amount_raised: number | null; date: string | null }) => `${r.round_type} ${usd(r.amount_raised)} ${r.date ?? "(no date)"}`;

const on = (r: Run) => Object.entries(r.settings?.components ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
console.log(`A: ${aPath}\n   components on: ${on(a)}`);
console.log(`B: ${bPath}\n   components on: ${on(b)}\n`);

console.log(`${"field".padEnd(16)}${"precision A → B".padEnd(20)}${"coverage A → B".padEnd(20)}scored`);
for (const field of Object.keys(b.fields)) {
  const fa = a.fields[field], fb = b.fields[field];
  console.log(`${field.padEnd(16)}${`${fa?.precision ?? "—"} → ${fb.precision}`.padEnd(20)}${`${fa?.coverage ?? "—"} → ${fb.coverage}`.padEnd(20)}${fa?.scored ?? "—"} / ${fb.scored}`);
}
console.log("\nPhase 1 rules (A → B):");
for (const rb of b.phase1) {
  const ra = a.phase1.find((r) => r.rule === rb.rule);
  console.log(`  ${ra?.pass ? "✅" : "❌"} → ${rb.pass ? "✅" : "❌"}  ${rb.rule} — ${ra?.detail ?? "—"} → ${rb.detail}`);
}
if (a.cost && b.cost) console.log(`\nCost per company: $${a.cost.per_company_usd.toFixed(4)} → $${b.cost.per_company_usd.toFixed(4)} · time: ${a.cost.seconds_per_company.toFixed(0)} s → ${b.cost.seconds_per_company.toFixed(0)} s`);

console.log("\nPer company — what B has that A does not (+), and A has that B does not (−):");
for (const id of Object.keys(b.per_company)) {
  const oa = a.per_company[id]?.output, ob = b.per_company[id]?.output;
  if (!oa && !ob) continue;
  const lines: string[] = [];
  const ra = new Set((oa?.rounds ?? []).map(roundKey)), rb = new Set((ob?.rounds ?? []).map(roundKey));
  for (const r of rb) if (!ra.has(r)) lines.push(`+ round ${r}`);
  for (const r of ra) if (!rb.has(r)) lines.push(`− round ${r}`);
  const fa = new Set((oa?.founders ?? []).map((f) => f.name)), fb = new Set((ob?.founders ?? []).map((f) => f.name));
  for (const f of fb) if (!fa.has(f)) lines.push(`+ founder ${f}`);
  for (const f of fa) if (!fb.has(f)) lines.push(`− founder ${f}`);
  if ((oa?.city ?? null) !== (ob?.city ?? null) || (oa?.country ?? null) !== (ob?.country ?? null)) lines.push(`location ${oa?.city ?? "—"}, ${oa?.country ?? "—"} → ${ob?.city ?? "—"}, ${ob?.country ?? "—"}`);
  const sa = a.per_company[id]?.fields, sb = b.per_company[id]?.fields;
  const scoreChanges = Object.keys(sb ?? {}).filter((f) => sa?.[f] !== sb?.[f]).map((f) => `${f}: ${sa?.[f] ?? "—"} → ${sb?.[f]}`);
  if (lines.length === 0 && scoreChanges.length === 0) continue;
  console.log(`\n── ${id}${scoreChanges.length ? `  (${scoreChanges.join(" · ")})` : ""}`);
  for (const l of lines) console.log(`   ${l}`);
}
