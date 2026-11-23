#!/usr/bin/env node
/**
 * scripts/check_baseline_in_db.ts — stage 1.1 (owner, 2026-11-23). READS ONLY, writes nothing.
 * Every value of the baselines of batches 5–8 (baseline/batch_N.json): is it in the column it belongs to (startups / funding_rounds / headcount_history)?
 * Prints each missing value with the company, the field, the batch and the run_ids that touched the company (field_changes).
 *   npx tsx scripts/check_baseline_in_db.ts            (batches 5 6 7 8)     BATCHES="8" to limit; SHOW="Humi,LionDesk" prints those companies' rows too
 */
import { createClient } from "@supabase/supabase-js";
import { loadBaseline, isCoreFieldForBaseline } from "./lib/baselineRead.ts";
import { checkWritten, type DbCompany, type ReportRow } from "../lib/enrichment/writtenCheck.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const batches = (process.env.BATCHES ?? "5 6 7 8").split(/[ ,]+/).map(Number).filter(Boolean);
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

(async () => {
  const { data: secs } = await db.from("sectors").select("id, name");
  const sectorName = new Map(((secs ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
  let totalMissing = 0, totalChecked = 0;
  for (const n of batches) {
    const b = loadBaseline(n);
    if (!b) { console.log(`batch ${n}: no baseline file (baseline/batch_${n}.json)`); continue; }
    const vals = b.values.filter(isCoreFieldForBaseline);
    const names = [...new Set(vals.map((v) => v.company))];
    const idByName = new Map<string, string>(), amb: string[] = [];
    const byId = new Map<string, DbCompany>();
    for (let i = 0; i < names.length; i += 40) {
      const chunk = names.slice(i, i + 40);
      const { data, error } = await db.from("startups").select("id, name, city, country, founded_year, founding_country, employee_range, employee_count, description, industry, sector_id, offices, founders, leadership, competitors, news, patents, status, acquired_by, exit_date").in("name", chunk);
      if (error) throw new Error(`startups: ${error.message}`);
      for (const s of (data ?? []) as Array<Record<string, unknown>>) {
        const nm = s.name as string;
        if (idByName.has(fold(nm))) { amb.push(nm); continue; }
        idByName.set(fold(nm), s.id as string);
        byId.set(s.id as string, { ...(s as object), sector_name: sectorName.get(s.sector_id as string) ?? null, rounds: [], headcount: [] } as DbCompany);
      }
    }
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { data: rs } = await db.from("funding_rounds").select("startup_id, round_type, amount_raised, announcement_date").in("startup_id", chunk);
      for (const r of (rs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(r.startup_id)?.rounds.push(r as never);
      const { data: hs } = await db.from("headcount_history").select("startup_id, employee_count, snapshot_date").in("startup_id", chunk);
      for (const h of (hs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(h.startup_id)?.headcount.push(h as never);
    }
    const rows: ReportRow[] = vals.map((v) => ({ company_id: idByName.get(fold(v.company)) ?? `NOT_FOUND:${v.company}`, company: v.company, field: v.field, after: v.value }));
    const res = checkWritten(rows, byId);
    totalMissing += res.missing.length; totalChecked += res.checked;
    console.log(`\n── batch ${n}: ${vals.length} core value(s) in the baseline · ${res.checked} checked against the database · ${res.notChecked} not checkable · ${res.missing.length} MISSING${amb.length ? ` · ambiguous name(s): ${[...new Set(amb)].join(", ")}` : ""}`);
    const missIds = [...new Set(res.missing.map((m) => m.company_id).filter((x) => !x.startsWith("NOT_FOUND")))];
    const runsOf = new Map<string, Set<string>>();
    for (let i = 0; i < missIds.length; i += 50) {
      const { data } = await db.from("field_changes").select("startup_id, run_id").in("startup_id", missIds.slice(i, i + 50));
      for (const r of (data ?? []) as Array<{ startup_id: string; run_id: string | null }>) { if (!runsOf.has(r.startup_id)) runsOf.set(r.startup_id, new Set()); if (r.run_id) runsOf.get(r.startup_id)!.add(r.run_id); }
    }
    for (const m of res.missing) console.log(`  ✗ ${m.company} · ${m.field}: ${m.after.slice(0, 100)}${m.company_id.startsWith("NOT_FOUND") ? "  [company not found by name]" : `  [runs touching it: ${[...(runsOf.get(m.company_id) ?? [])].join(" ") || "none recorded"}]`}`);
  }
  console.log(`\nTotal: ${totalChecked} checked, ${totalMissing} missing.`);
  for (const nm of (process.env.SHOW ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const { data } = await db.from("startups").select("id, name, city, country, description, status, updated_at").ilike("name", nm);
    for (const s of (data ?? []) as Array<Record<string, unknown>>) {
      console.log(`\n${nm}: city=${JSON.stringify(s.city)} country=${JSON.stringify(s.country)} description=${s.description ? JSON.stringify(String(s.description).slice(0, 80)) : "EMPTY"} status=${s.status} updated=${s.updated_at}`);
      const { data: ch } = await db.from("field_changes").select("field, old_value, new_value, run_id, created_at").eq("startup_id", s.id as string).in("field", ["city", "country", "description"]).order("created_at");
      for (const c of (ch ?? []) as Array<Record<string, unknown>>) console.log(`   change ${c.field}: ${JSON.stringify(c.old_value)?.slice(0, 40)} → ${JSON.stringify(c.new_value)?.slice(0, 40)} run ${c.run_id} at ${c.created_at}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(2); });
