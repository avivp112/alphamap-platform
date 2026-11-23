#!/usr/bin/env node
/**
 * scripts/batch_coverage.ts — stage 1.2 (owner, 2026-11-23). READS ONLY, writes nothing.
 * Why a batch's coverage is what it is: for each core field of the dry report, how many companies had a value found, how many of those the database already held (the writer fills only what is empty),
 * and what the remembered-but-not-written rows are.   BATCH_NO=9 npx tsx scripts/batch_coverage.ts   (files in the current directory: pilot_report_dry.csv, pilot_report_write.csv, carried_not_written.csv)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const load = (p: string) => { if (!existsSync(p)) return null; const [h, ...b] = parseCsv(readFileSync(p, "utf8").replace(/^﻿/, "")); return b.map((r) => Object.fromEntries(h.map((c, i) => [c, r[i] ?? ""]))) as Array<Record<string, string>>; };

(async () => {
  const dry = load("pilot_report_dry.csv"), wet = load("pilot_report_write.csv"), carried = load("carried_not_written.csv");
  if (!dry) { console.error("pilot_report_dry.csv is missing"); process.exit(2); }
  const per = (rows: Array<Record<string, string>>) => { const m = new Map<string, Set<string>>(); for (const r of rows) { if (!r.field || r.field === "(nothing)") continue; if (!m.has(r.field)) m.set(r.field, new Set()); m.get(r.field)!.add(r.company_id); } return m; };
  const d = per(dry), w = wet ? per(wet) : new Map<string, Set<string>>();
  console.log("field                 | dry report (companies) | wet report (companies)");
  for (const f of [...d.keys()].sort()) console.log(`${f.padEnd(22)}| ${String(d.get(f)!.size).padEnd(23)}| ${w.get(f)?.size ?? 0}`);
  // what the database already held for the companies of the dry report
  const ids = [...new Set(dry.map((r) => r.company_id).filter(Boolean))];
  const have = { description: 0, city: 0, country: 0, sector_id: 0, founded_year: 0, activeStatus: 0, acquiredStatus: 0, n: 0 };
  const rowsById = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await db.from("startups").select("id, description, city, country, sector_id, founded_year, status, acquired_by").in("id", ids.slice(i, i + 50));
    if (error) throw new Error(error.message);
    for (const s of (data ?? []) as Array<Record<string, unknown>>) rowsById.set(s.id as string, s);
  }
  const holds = (f: string, s: Record<string, unknown> | undefined) => !!s && ({ description: !!s.description, hq_city: !!s.city, hq_country: !!s.country, sector: !!s.sector_id, founded_year: s.founded_year != null } as Record<string, boolean>)[f];
  console.log("\nA value found in the dry report, and the database ALREADY held that field when the batch was written (the writer fills only empty fields; counted now, after the write, so it includes the write itself):");
  for (const f of ["description", "hq_city", "hq_country", "sector", "founded_year"]) { const cs = [...(d.get(f) ?? [])]; console.log(`  ${f}: found ${cs.length} · database holds a value now ${cs.filter((c) => holds(f, rowsById.get(c))).length}${w.get(f) ? ` · written in the wet report ${w.get(f)!.size}` : ""}`); }
  const acq = [...(d.get("acquired") ?? [])];
  console.log(`\nacquired: found in the dry report ${acq.length} · written in the wet report ${w.get("acquired")?.size ?? 0} · database status now: ${acq.map((c) => String(rowsById.get(c)?.status ?? "?")).reduce((a: Record<string, number>, s) => (a[s] = (a[s] ?? 0) + 1, a), {} as Record<string, number>) && JSON.stringify(acq.map((c) => String(rowsById.get(c)?.status ?? "?")).reduce((a: Record<string, number>, s) => (a[s] = (a[s] ?? 0) + 1, a), {}))}`);
  for (const c of acq.slice(0, 15)) { const r = dry.find((x) => x.company_id === c && x.field === "acquired")!; console.log(`   ${r.company}: ${r.after} · origin ${r.origin}`); }
  if (carried) {
    const by = new Map<string, number>(); for (const r of carried) by.set(r.field, (by.get(r.field) ?? 0) + 1);
    console.log(`\ncarried_not_written.csv: ${carried.length} row(s) by field: ${[...by].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(" · ")}`);
  }
})().catch((e) => { console.error(e); process.exit(2); });
