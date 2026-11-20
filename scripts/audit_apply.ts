#!/usr/bin/env node
/**
 * scripts/audit_apply.ts — what the post-write audit found (owner, 2026-11-20). The batch is not stopped.
 *   - each wrong value is taken out of the database (a startups column emptied, a founder removed from the list, a round deleted — recorded in field_changes under a run of its own, so undo_run puts it back) and
 *     written to pending_fixes.csv; a wrong acquired value is listed for a manual correction (correct_db);
 *   - the random sample is added to eval/field_audit.json (per field: audited, wrong);
 *   - a field with errors in more than 5 companies of the targeted sample, or with a cumulative random accuracy under its tier's bar, is undone for this run (undo_run) and held (held_fields.csv) until the maintenance window.
 *   BATCH_NO=8 WRONG=3,17=reason npx tsx scripts/audit_apply.ts            report only (nothing changes)
 *   BATCH_NO=8 WRONG=3,17=reason DRY_RUN=false npx tsx scripts/audit_apply.ts
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { accumulate, decide, type Drawn, type FieldAudit } from "../lib/enrichment/audit.ts";
import { addHeldFields, addPendingFixes } from "../lib/enrichment/batchProcess.ts";
import { startupChanges, roundDeleteChange } from "../lib/enrichment/runChanges.ts";
import { FIELD_COLUMNS } from "../lib/enrichment/writeUnits.ts";
import { familyOfField } from "../lib/enrichment/tiers.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const file = `audit_batch_${batch}.csv`;
if (!existsSync(file)) { console.error(`${file} not found — run audit_sample.ts first`); process.exit(2); }
const [h, ...b] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
const ix = (c: string) => h.indexOf(c);
const drawn: Drawn[] = b.map((r) => ({ n: Number(r[ix("n")]), kind: r[ix("kind")] as "random" | "targeted", company_id: r[ix("company_id")], company: r[ix("company")], field: r[ix("field")], value: r[ix("value")], source_url: r[ix("source_url")], quote: r[ix("quote")] }));
const wrong = new Map<number, string>();
for (const p of (process.env.WRONG ?? "").split(",").map((x) => x.trim()).filter((x) => x && x !== "none")) { const [n, ...why] = p.split("="); const num = Number(n); if (!drawn.some((d) => d.n === num)) { console.error(`#${n} is not in ${file}`); process.exit(2); } wrong.set(num, why.join("=").trim() || "wrong in the audit"); }
if (!process.env.WRONG) { console.error("WRONG=<numbers> (or WRONG=none) is required"); process.exit(2); }
const WRITE = process.env.DRY_RUN === "false";
const AUDIT = "eval/field_audit.json";
const cumBefore: FieldAudit = existsSync(AUDIT) ? JSON.parse(readFileSync(AUDIT, "utf8")) : {};
const cum = accumulate(cumBefore, batch, drawn, new Set(wrong.keys()));
const verdicts = decide(drawn, new Set(wrong.keys()), cum);

const SCALAR: Record<string, string[]> = { description: ["description", "value_proposition"], sector: ["sector_id", "industry"], hq_city: ["city"], hq_country: ["country"], founded_year: ["founded_year"],
  legal_name: ["legal_name"], company_number: ["company_number"], incorporation_date: ["incorporation_date"], incorporation_jurisdiction: ["incorporation_jurisdiction"], registered_address: ["registered_address"] };

(async () => {
  console.log(`${wrong.size} wrong of ${drawn.length} audited (${drawn.filter((d) => d.kind === "random" && wrong.has(d.n)).length}/25 random, ${drawn.filter((d) => d.kind === "targeted" && wrong.has(d.n)).length}/25 targeted)\n`);
  for (const v of verdicts) console.log(`${v.undo ? "⏸️  UNDO + HOLD" : wrongCount(v.field) ? "✂️  fix values  " : "✅ ok          "} ${v.field.padEnd(26)} random ${v.randomWrong}/${v.randomAudited} wrong · targeted: errors in ${v.targetedWrongCompanies} compan(ies)${v.why ? ` — ${v.why}` : ""}`);
  function wrongCount(field: string) { return drawn.some((d) => familyOfField(d.field) === field && wrong.has(d.n)); }
  const undo = verdicts.filter((v) => v.undo).map((v) => v.field);
  const fixes = drawn.filter((d) => wrong.has(d.n) && !undo.includes(familyOfField(d.field)));
  console.log(`\n${fixes.length} value(s) to take out of the database; ${undo.length} field(s) undone for the run.`);
  if (!WRITE) { console.log("nothing changed. DRY_RUN=false does it."); return; }

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const manual: string[] = [];
  if (fixes.length) {
    const { data: run, error } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "audit_fix", batch, values: fixes.length } }).select("run_id").single();
    if (error || !run) { console.error(`⛔  enrichment_runs: ${error?.message}`); process.exit(1); }
    for (const f of fixes) {
      const field = familyOfField(f.field), reason = wrong.get(f.n)!;
      const changes = [] as ReturnType<typeof startupChanges>;
      if (SCALAR[field]) {
        const cols = SCALAR[field];
        const { data: row } = await db.from("startups").select(["id", ...cols].join(",")).eq("id", f.company_id).single();
        if (!row) { manual.push(`${f.company} · ${field}: startup not found`); continue; }
        const patch = Object.fromEntries(cols.map((c) => [c, null]));
        changes.push(...startupChanges(f.company_id, row as unknown as Record<string, unknown>, patch, run.run_id));
        const ch = await db.from("field_changes").insert(changes); if (ch.error) { manual.push(`${f.company} · ${field}: field_changes ${ch.error.message}`); continue; }
        const up = await db.from("startups").update(patch).eq("id", f.company_id); if (up.error) { manual.push(`${f.company} · ${field}: ${up.error.message}`); continue; }
      } else if (field === "founder") {
        const name = f.value.split(" — ")[0].trim().toLowerCase();
        const { data: row } = await db.from("startups").select("id, founders").eq("id", f.company_id).single();
        const list = ((row as { founders?: Array<{ name?: string }> } | null)?.founders ?? []);
        const keep = list.filter((p) => (p.name ?? "").trim().toLowerCase() !== name);
        if (keep.length === list.length) { manual.push(`${f.company} · founder ${name}: not in the list`); continue; }
        const ch = await db.from("field_changes").insert(startupChanges(f.company_id, { founders: list }, { founders: keep }, run.run_id)); if (ch.error) { manual.push(`${f.company} · founder: ${ch.error.message}`); continue; }
        const up = await db.from("startups").update({ founders: keep }).eq("id", f.company_id); if (up.error) { manual.push(`${f.company} · founder: ${up.error.message}`); continue; }
      } else if (field === "round") {
        const t = f.value.match(/^(Pre-Seed|Seed|Series [A-F]\+?|Growth|Bridge|Debt|Other|Unknown)\b/)?.[1] ?? "";
        const am = f.value.match(/\$([\d.,]+)\s*([KMB])?/i); const amount = am ? Number(am[1].replace(/,/g, "")) * (am[2]?.toUpperCase() === "B" ? 1e9 : am[2]?.toUpperCase() === "K" ? 1e3 : 1e6) : null;
        const { data: rounds } = await db.from("funding_rounds").select("*").eq("startup_id", f.company_id);
        const hit = (rounds ?? []).filter((r: Record<string, unknown>) => (!t || String(r.round_type ?? "").toLowerCase() === t.toLowerCase() || t === "Unknown") && (amount == null || Math.abs(Number(r.amount_raised ?? 0) - amount) / amount < 0.01));
        if (hit.length !== 1) { manual.push(`${f.company} · round "${f.value.slice(0, 60)}": ${hit.length} matching round(s) — correct by hand`); continue; }
        const r = hit[0] as Record<string, unknown>;
        const ch = await db.from("field_changes").insert(roundDeleteChange(f.company_id, String(r.id), r, run.run_id)); if (ch.error) { manual.push(`${f.company} · round: ${ch.error.message}`); continue; }
        await db.from("field_provenance").delete().eq("startup_id", f.company_id).eq("field", "round").like("value", `%${String(r.id)}%`);
        const del = await db.from("funding_rounds").delete().eq("id", r.id as string); if (del.error) { manual.push(`${f.company} · round: ${del.error.message}`); continue; }
      } else { manual.push(`${f.company} · ${field}: "${f.value.slice(0, 70)}" — correct with correct_db / by hand`); }
      console.log(`✓ ${f.company} · ${field}: taken out of the database`);
    }
    console.log(`run ${run.run_id} (undo: RUN_ID=${run.run_id} DRY_RUN=false npx tsx scripts/undo_run.ts)`);
  }
  addPendingFixes(fixes.map((f) => ({ batch, company: f.company, field: f.field, value: f.value, reason: `audit: ${wrong.get(f.n)}` })));
  for (const m of manual) console.log(`⚠️  by hand: ${m}`);

  if (undo.length) {
    const summary = existsSync(`batch_${batch}_summary.md`) ? readFileSync(`batch_${batch}_summary.md`, "utf8") : "";
    const runId = summary.match(/run_id: ([0-9a-f-]{36})/)?.[1];
    for (const field of undo) {
      const cols = field === "round" ? ["funding_rounds"] : FIELD_COLUMNS[field] ?? [];
      if (!runId || !cols.length) { console.log(`⚠️  ${field}: undo by hand — RUN_ID=<the batch's run_id> FIELDS=${cols.join(",") || "?"} DRY_RUN=false npx tsx scripts/undo_run.ts`); continue; }
      const r = spawnSync("npx", ["tsx", "scripts/undo_run.ts"], { stdio: "inherit", env: { ...process.env, RUN_ID: runId, FIELDS: cols.join(","), DRY_RUN: "false" } });
      console.log(r.status === 0 ? `✓ ${field} undone for the run` : `⛔ undo of ${field} failed (exit ${r.status}) — by hand`);
    }
    addHeldFields(verdicts.filter((v) => v.undo).map((v) => ({ batch, field: v.field, source: "audit", detail: v.why })));
  }
  writeFileSync(AUDIT, JSON.stringify(cum, null, 1) + "\n");
  console.log(`\n${AUDIT} updated. Pilot visibility:  npx tsx scripts/field_status.ts`);
})();
