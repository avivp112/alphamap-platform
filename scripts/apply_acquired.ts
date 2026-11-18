#!/usr/bin/env node
/**
 * scripts/apply_acquired.ts — writes the purchases of a dry report to the database (owner, round 10: Humi, Medipass, Six Degrees, Dietly), with a run, field_changes (so the run
 * can be undone) and a field_provenance row per value. The rows come from the report's `acquired` and `brand_after_acquisition` lines — which come from accepted news — so
 * nothing new is searched. Only a company whose status is "active" on file is touched. Needs migration 20261202000000.
 *
 *   npx tsx scripts/apply_acquired.ts [pilot_report_dry.csv]                  # report only (the default)
 *   DRY_RUN=false BATCH=5 npx tsx scripts/apply_acquired.ts [report.csv]      # writes
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const DRY_RUN = process.env.DRY_RUN !== "false";
const db = createClient(url, key, { auth: { persistSession: false } });

const [head, ...body] = parseCsv(readFileSync(process.argv[2] ?? "pilot_report_dry.csv", "utf8"));
const ix = (n: string) => head.indexOf(n);
interface Purchase { id: string; name: string; status: string; acquirer: string; date: string | null; url: string; quote: string; brand?: string; brandUrl?: string; brandQuote?: string }
const byId = new Map<string, Purchase>();
for (const r of body) {
  const f = r[ix("field")], id = r[ix("company_id")];
  if (f === "acquired") {
    const m = (r[ix("after")] ?? "").match(/^status = (acquired|majority_acquired) · Acquired by (.+?) \((\d{4}-\d{2}-\d{2}|undated)\)$/);
    const cl = (r[ix("after")] ?? "").match(/^status = closed · Closed \((\d{4}-\d{2}-\d{2}|undated)\)$/);
    if (cl) byId.set(id, { id, name: r[ix("company")], status: "closed", acquirer: "", date: cl[1] === "undated" ? null : cl[1], url: r[ix("source_url")], quote: r[ix("quote")] } as Purchase);
    if (m) byId.set(id, { ...(byId.get(id) ?? {}), id, name: r[ix("company")], status: m[1], acquirer: m[2], date: m[3] === "undated" ? null : m[3], url: r[ix("source_url")], quote: r[ix("quote")] } as Purchase);
  }
}
for (const r of body) if (r[ix("field")] === "brand_after_acquisition" && byId.has(r[ix("company_id")])) {
  const p = byId.get(r[ix("company_id")])!; const b = (r[ix("after")] ?? "").replace(/^brand after the acquisition:\s*/, "").trim();
  if (b) { p.brand = b; p.brandUrl = r[ix("source_url")]; p.brandQuote = r[ix("quote")]; }
}
if (!byId.size) { console.log("No acquired line in the report."); process.exit(0); }

const { data: rows, error } = await db.from("startups").select("id, name, status, acquired_by, exit_date").in("id", [...byId.keys()]);
if (error) { console.error(error.message); process.exit(1); }
const onFile = new Map(((rows ?? []) as Array<{ id: string; name: string; status: string; acquired_by: string | null; exit_date: string | null }>).map((r) => [r.id, r]));
const todo: Purchase[] = [];
for (const p of byId.values()) {
  const f = onFile.get(p.id);
  const ok = f && f.status === "active";
  console.log(`${ok ? "to write " : "skipped  "} ${p.name}: ${p.status} · ${p.acquirer} · ${p.date ?? "undated"}${p.brand ? ` · now ${p.brand}` : ""}${ok ? "" : ` — on file status "${f?.status ?? "?"}"`}\n           ${p.url}\n           "${p.quote.slice(0, 110)}"`);
  if (ok) todo.push(p);
}
console.log(`\n${todo.length} of ${byId.size} ${DRY_RUN ? "would be written" : "to write"}.`);
if (DRY_RUN || !todo.length) process.exit(0);

const { data: run, error: runErr } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "bulk", dry_run: false, thresholds: { batch: Number(process.env.BATCH) || null, MODE: "acquired_from_report" } }).select("run_id").single();
if (runErr || !run) { console.error(`could not register the run: ${runErr?.message}`); process.exit(1); }
const runId = (run as { run_id: string }).run_id;
for (const p of todo) {
  const f = onFile.get(p.id)!;
  const patch: Record<string, unknown> = { status: p.status, ...(p.acquirer ? { acquired_by: p.acquirer } : {}), ...(p.date ? { exit_date: p.date } : {}), ...(p.brand ? { brand_after_acquisition: p.brand } : {}) };
  const { error: upErr } = await db.from("startups").update(patch).eq("id", p.id).eq("status", "active");
  if (upErr) { console.error(`${p.name}: ${upErr.message} (migration 20261202000000 applied?)`); continue; }
  const old: Record<string, unknown> = { status: f.status, acquired_by: f.acquired_by, exit_date: f.exit_date, brand_after_acquisition: null };
  await db.from("field_changes").insert(Object.entries(patch).map(([field, v]) => ({ startup_id: p.id, field, old_value: old[field] ?? null, new_value: v, source_url: field === "brand_after_acquisition" ? p.brandUrl ?? p.url : p.url, run_id: runId })));
  const prov = Object.entries(patch).map(([field, v]) => ({ startup_id: p.id, field: `acquired.${field}`, value: v, source_url: field === "brand_after_acquisition" ? p.brandUrl ?? p.url : p.url, source_type: "news", confidence: 55, run_id: runId, evidence_quote: field === "brand_after_acquisition" ? p.brandQuote ?? p.quote : p.quote }));
  const { error: pErr } = await db.from("field_provenance").insert(prov);
  if (pErr) console.warn(`${p.name}: field_provenance — ${pErr.message}`);
  console.log(`✏️  ${p.name}: written`);
}
await db.from("enrichment_runs").update({ finished_at: new Date().toISOString(), companies_count: todo.length }).eq("run_id", runId);
const { error: refErr } = await db.rpc("refresh_startups_search");
console.log(`\n🧾 run_id ${runId} — undo: RUN_ID=${runId} npx tsx scripts/undo_run.ts\n${refErr ? `⚠️ startups_search not refreshed (${refErr.message})` : "🔄 startups_search refreshed"}`);
setTimeout(() => process.exit(0), 500).unref();
