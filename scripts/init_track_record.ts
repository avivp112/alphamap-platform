#!/usr/bin/env node
/**
 * scripts/init_track_record.ts — field_track_record.json from the written batches (owner, 2026-11-19).
 * A value of baseline/batch_N.json (written, not undone) counts as checked and right; a value excluded (EXCLUDE: excluded_values.csv of the batch's archive, pending_fixes.csv) or taken back from the database
 * (undo_value / remove_news runs in field_changes) counts as a wrong one, with its reason. Needs the database only for the undone values (SUPABASE_*); without it those are not counted and it says so.
 *   BATCHES=5,6,7 npx tsx scripts/init_track_record.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, readdirSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { addToTrackRecord, familyOf, readPendingFixes } from "../lib/enrichment/batchProcess.ts";
import { loadBaseline } from "../lib/enrichment/regressionGate.ts";

if (existsSync(".env")) config({ path: ".env" });
const batches = (process.env.BATCHES ?? "5,6,7").split(",").map(Number);
const COLUMN_FIELD: Record<string, string> = { news: "news", competitors: "competitor_declared", founders: "founder", leadership: "leader", status: "acquired", acquired_by: "acquired", exit_date: "acquired" };
const idsOf = (n: number): Set<string> => { try { const j = JSON.parse(readFileSync(`pilot_batch_${n}.json`, "utf8")); return new Set((Array.isArray(j) ? j : j.companies ?? []).map((c: { id: string }) => c.id)); } catch { return new Set(); } };

(async () => {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  const undone = new Map<number, Map<string, number>>();   // batch → field → count
  if (db) {
    const { data: runs } = await db.from("enrichment_runs").select("run_id, thresholds").in("thresholds->>MODE", ["undo_value", "remove_news"]);
    for (const r of (runs ?? []) as Array<{ run_id: string }>) {
      const { data: ch } = await db.from("field_changes").select("startup_id, field").eq("run_id", r.run_id);
      for (const c of (ch ?? []) as Array<{ startup_id: string; field: string }>) {
        const f = COLUMN_FIELD[c.field]; if (!f) continue;
        for (const n of batches) if (idsOf(n).has(c.startup_id)) { const m = undone.get(n) ?? undone.set(n, new Map()).get(n)!; m.set(f, (m.get(f) ?? 0) + 1); }
      }
    }
  } else console.log("⚠️  no database access: values taken back with undo_value are not counted.");
  const excluded = new Map<number, Map<string, number>>();
  const addEx = (n: number, field: string) => { const m = excluded.get(n) ?? excluded.set(n, new Map()).get(n)!; m.set(familyOf(field), (m.get(familyOf(field)) ?? 0) + 1); };
  for (const dir of existsSync("archive") ? readdirSync("archive") : []) {
    const n = Number(dir.replace(/^batch/, "")); const f = `archive/${dir}/excluded_values.csv`;
    if (!batches.includes(n) || !existsSync(f)) continue;
    const [h, ...b] = parseCsv(readFileSync(f, "utf8")); for (const r of b) addEx(n, r[h.indexOf("field")] ?? "");
  }
  for (const p of readPendingFixes()) if (batches.includes(p.batch)) addEx(p.batch, p.field);
  for (const n of batches) {
    const base = loadBaseline(n); if (!base) { console.log(`batch ${n}: no baseline`); continue; }
    const total = new Map<string, Set<string>>();
    for (const v of base.values) { const f = familyOf(v.field); (total.get(f) ?? total.set(f, new Set()).get(f)!).add(f === "acquired" ? v.company : `${v.company}|${v.value}`); }
    const fields = [...total].map(([field, set]) => ({ field, total: set.size, wrong: (undone.get(n)?.get(field) ?? 0) + (excluded.get(n)?.get(field) ?? 0) }));
    addToTrackRecord(n, fields);
    console.log(`batch ${n}: ${fields.map((x) => `${x.field} ${x.total}${x.wrong ? ` (${x.wrong} wrong)` : ""}`).join(" · ")}`);
  }
  console.log("field_track_record.json written. Commit it with the baselines.");
})().catch((e) => { console.error(e); process.exit(1); });
