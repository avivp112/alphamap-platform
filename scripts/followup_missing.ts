#!/usr/bin/env node
/**
 * scripts/followup_missing.ts — companies a wet v2 run wrote that still have no description, or too little data to be listed (owner, round 10): the list to work through one by one.
 * "Too little data" is the platform's own bar: completeness_score under 7 (startups_market, migration 20261010000000). Read-only.
 *
 *   npx tsx scripts/followup_missing.ts            # prints the list and writes followup/missing_<date>.csv
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "fs";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const { data: runs, error: runErr } = await db.from("enrichment_runs").select("run_id, started_at, thresholds").eq("pipeline", "v2").eq("dry_run", false);
if (runErr) { console.error(runErr.message); process.exit(1); }
const runIds = (runs ?? []).map((r) => (r as { run_id: string }).run_id);
const batchOf = new Map((runs ?? []).map((r) => [(r as { run_id: string }).run_id, String((r as { thresholds?: { batch?: number } }).thresholds?.batch ?? "?")]));
if (!runIds.length) { console.log("No wet v2 run yet."); process.exit(0); }

const written = new Map<string, string>();   // startup_id → batch
for (let i = 0; i < runIds.length; i += 20) {
  const { data, error } = await db.from("field_changes").select("startup_id, run_id").in("run_id", runIds.slice(i, i + 20));
  if (error) { console.error(error.message); process.exit(1); }
  for (const r of (data ?? []) as Array<{ startup_id: string; run_id: string }>) written.set(r.startup_id, batchOf.get(r.run_id) ?? "?");
}
const ids = [...written.keys()];
const rows: Array<{ id: string; name: string; description: string | null; website: string | null }> = [];
for (let i = 0; i < ids.length; i += 100) {
  const { data, error } = await db.from("startups").select("id, name, description, website").in("id", ids.slice(i, i + 100));
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...((data ?? []) as typeof rows));
}
const { data: scores } = await db.from("startups_search").select("id, completeness_score").in("id", ids.slice(0, 1000));
const score = new Map(((scores ?? []) as Array<{ id: string; completeness_score: number }>).map((s) => [s.id, s.completeness_score]));

const out = rows.flatMap((r) => {
  const noDesc = !(r.description ?? "").trim();
  const low = (score.get(r.id) ?? 0) < 7;
  if (!noDesc && !low) return [];
  return [{ batch: written.get(r.id) ?? "?", company: r.name, id: r.id, website: r.website ?? "", why: [noDesc && "no description", low && `completeness ${score.get(r.id) ?? "?"} < 7`].filter(Boolean).join("; ") }];
}).sort((a, b) => a.batch.localeCompare(b.batch) || a.company.localeCompare(b.company));
console.log(`${out.length} of ${rows.length} wet-enriched company(ies) lack a description or data:\n`);
for (const r of out) console.log(`  batch ${r.batch}  ${r.company}  — ${r.why}  ${r.website}`);
mkdirSync("followup", { recursive: true });
const file = `followup/missing_${new Date().toISOString().slice(0, 10)}.csv`;
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(file, "﻿" + ["batch,company,id,website,why", ...out.map((r) => [r.batch, r.company, r.id, r.website, r.why].map(q).join(","))].join("\r\n") + "\r\n");
console.log(`\n📝 ${file}`);
setTimeout(() => process.exit(0), 500).unref();
