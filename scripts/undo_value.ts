#!/usr/bin/env node
/**
 * scripts/undo_value.ts — take back ONE value of a wet batch (owner, 2026-11-09): one wrong news item in a batch of 25 should not
 * cost the other 24 (undo_run puts back whole columns). The value is removed from its list (news, competitors, leadership, founders)
 * as the list is now; the change is recorded in field_changes under a run of its own, and the value's field_provenance row goes.
 * Round fills and patents are not list entries: undo the whole run (scripts/undo_run.ts) for those.
 *
 *   BATCH=field_review/batch_3.csv VALUE=w3.23 npx tsx scripts/undo_value.ts                  # report only
 *   BATCH=field_review/batch_3.csv VALUE=w3.23,w3.1 DRY_RUN=false npx tsx scripts/undo_value.ts
 *
 * The tracker is not touched: the mark stays (a wrong value stays counted as wrong until the rules that now reject it make the replay
 * leave it out).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseCsvText } from "../lib/enrichment/fieldReview.ts";
import { LIST_COLUMN, isValueField, removeFromList, provenanceFieldOf } from "../lib/enrichment/undoValue.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const DRY_RUN = process.env.DRY_RUN !== "false";
const path = process.env.BATCH;
const ids = (process.env.VALUE ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!path || !existsSync(path) || !ids.length) { console.error("BATCH=<batch csv> and VALUE=<ids, e.g. w3.23> are required."); process.exit(1); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const [head, ...rows] = parseCsvText(readFileSync(path, "utf8").replace(/^﻿/, ""));
const at = (n: string) => head.indexOf(n);
const values = rows.map((r) => ({ id: r[at("id")], field: r[at("field")], company: r[at("company")], value: r[at("value")], source_url: r[at("source_url")] || null, company_id: r[at("company_id")] }));

(async () => {
  let runId: string | null = null;
  for (const id of ids) {
    const v = values.find((x) => x.id === id);
    if (!v) { console.log(`✗ ${id}: not in ${path}`); continue; }
    if (!isValueField(v.field)) { console.log(`✗ ${id} (${v.field}): not a list entry — undo the whole run: RUN_ID=<id> npx tsx scripts/undo_run.ts`); continue; }
    const { column } = LIST_COLUMN[v.field];
    const { data, error } = await db.from("startups").select(`id, name, ${column}`).eq("id", v.company_id).single();
    if (error || !data) { console.log(`✗ ${id}: company ${v.company_id} not read (${error?.message ?? "no row"})`); continue; }
    const current = (data as unknown as Record<string, unknown>)[column] as Array<Record<string, unknown>> | null;
    const { next, removed } = removeFromList(v.field, current, v.value, v.source_url);
    if (!removed) { console.log(`• ${id} ${v.company}: already not in ${column} — nothing to remove`); continue; }
    console.log(`${DRY_RUN ? "Would remove" : "Removing"} ${id} ${v.company}: ${v.value.slice(0, 110)}  (${column}: ${current?.length} → ${next.length})`);
    if (DRY_RUN) continue;
    if (!runId) {
      const { data: run, error: runErr } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "undo_value", batch: path, values: ids } }).select("run_id").single();
      if (runErr || !run) { console.error(`could not register the run (${runErr?.message}) — nothing changed, since it could not be recorded`); process.exit(1); }
      runId = (run as { run_id: string }).run_id;
    }
    const { error: chErr } = await db.from("field_changes").insert({ startup_id: v.company_id, field: column, old_value: current, new_value: next, source_url: v.source_url, run_id: runId });
    if (chErr) { console.error(`✗ ${id}: field_changes not recorded (${chErr.message}) — nothing changed`); continue; }
    const { error: upErr } = await db.from("startups").update({ [column]: next }).eq("id", v.company_id);
    if (upErr) { console.error(`✗ ${id}: ${upErr.message}`); continue; }
    // A competitor's provenance rows all share one field (market.competitors) and cannot be told apart here: they stay, said below.
    if (v.field === "competitor_declared" || v.field === "competitor_market") console.log("  ℹ️  its field_provenance row is left (competitors share one field); the list no longer shows it");
    else await db.from("field_provenance").delete().eq("startup_id", v.company_id).eq("field", provenanceFieldOf(v.field, v.value));
    console.log(`  ✔ removed; recorded under run ${runId}`);
  }
  if (DRY_RUN) console.log("\nDRY_RUN — nothing changed. DRY_RUN=false to remove.");
})().catch((e) => { console.error(e); process.exit(1); });
