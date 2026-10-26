#!/usr/bin/env node
/**
 * scripts/undo_run.ts — undo what an enrichment run wrote, by its run_id
 * (owner, 2026-10-26), from the field_changes rows the run recorded
 * (lib/enrichment/runChanges.ts):
 *
 *   a startups column     put back the value it replaced
 *   a round it inserted   deleted (with its field_provenance rows)
 *   a round field filled  emptied again
 *
 * A value someone changed after the run is left alone and reported. Several
 * runs are undone newest first, so each lands on the state before it.
 *
 * DRY_RUN (the default) changes nothing: a report per company and field, and
 * a CSV of every action (the backup of the current values when it writes).
 *
 *   LIST=true npx tsx scripts/undo_run.ts                       # recent runs and what each recorded
 *   RUN_ID=<id>[,<id>...] npx tsx scripts/undo_run.ts           # report only
 *   RUN_ID=<id> FIELDS=competitors npx tsx scripts/undo_run.ts  # only some fields
 *   RUN_ID=<id> DRY_RUN=false npx tsx scripts/undo_run.ts       # undo
 *
 * FIELDS defaults to patents, patent_count, patent_fields, competitors and
 * funding_rounds (new rounds and filled round fields — the round types).
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { planUndo, type FieldChangeRow, type UndoAction } from "../lib/enrichment/runChanges.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

const DRY_RUN = process.env.DRY_RUN !== "false";
const LIST = process.env.LIST === "true";
const RUN_IDS = (process.env.RUN_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const FIELDS = (process.env.FIELDS ?? "patents,patent_count,patent_fields,competitors,funding_rounds").split(",").map((s) => s.trim()).filter(Boolean);

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const short = (v: unknown) => { const s = JSON.stringify(v ?? null); return s.length > 160 ? `${s.slice(0, 157)}...` : s; };

async function changesOf(runId: string): Promise<FieldChangeRow[]> {
  const rows: FieldChangeRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("field_changes").select("startup_id, field, old_value, new_value, source_url, run_id")
      .eq("run_id", runId).order("created_at").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as FieldChangeRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function list() {
  const { data: runs, error } = await db.from("enrichment_runs").select("run_id, pipeline, run_kind, started_at, finished_at, dry_run, companies_count")
    .eq("dry_run", false).order("started_at", { ascending: false }).limit(20);
  if (error) throw error;
  if (!runs?.length) { console.log("No writing runs registered in enrichment_runs."); return; }
  for (const r of runs) {
    const { count } = await db.from("field_changes").select("id", { count: "exact", head: true }).eq("run_id", r.run_id);
    console.log(`${r.run_id}  ${r.started_at}  ${r.pipeline}/${r.run_kind}  companies ${r.companies_count ?? "?"}  recorded changes ${count ?? 0}`);
  }
  const { count: untraced } = await db.from("field_changes").select("id", { count: "exact", head: true }).is("run_id", null);
  if (untraced) console.log(`\n${untraced} older field_changes row(s) have no run_id — written before runs were recorded; they cannot be undone by run.`);
}

async function undo() {
  const { data: runs, error } = await db.from("enrichment_runs").select("run_id, started_at").in("run_id", RUN_IDS);
  if (error) throw error;
  const missing = RUN_IDS.filter((id) => !(runs ?? []).some((r) => r.run_id === id));
  if (missing.length) { console.error(`Unknown run_id: ${missing.join(", ")} (LIST=true shows the runs).`); process.exit(1); }
  const ordered = [...(runs ?? [])].sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));

  console.log(DRY_RUN ? "DRY_RUN — nothing is written. DRY_RUN=false to undo." : "Undoing.");
  console.log(`Fields: ${FIELDS.join(", ")}\n`);
  const report: Array<{ run: string; action: UndoAction }> = [];
  for (const run of ordered) {
    const changes = await changesOf(run.run_id);
    const startupIds = [...new Set(changes.map((c) => c.startup_id))];
    const roundIds = [...new Set(changes.filter((c) => c.field.startsWith("funding_rounds.")).map((c) => c.field.split(".")[1]))];
    const fields = [...new Set(changes.filter((c) => !c.field.startsWith("funding_rounds.")).map((c) => c.field))];
    const startups = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < startupIds.length; i += 200) {
      const { data, error: e } = await db.from("startups").select(["id", "name", ...fields].join(", ")).in("id", startupIds.slice(i, i + 200));
      if (e) throw e;
      for (const s of (data ?? []) as unknown as Array<Record<string, unknown>>) startups.set(s.id as string, s);
    }
    const rounds = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < roundIds.length; i += 200) {
      const { data, error: e } = await db.from("funding_rounds").select("*").in("id", roundIds.slice(i, i + 200));
      if (e) throw e;
      for (const r of (data ?? []) as Array<Record<string, unknown>>) rounds.set(r.id as string, r);
    }
    const actions = planUndo(changes, { startups, rounds }, FIELDS);
    console.log(`── run ${run.run_id} (${run.started_at}): ${changes.length} recorded change(s) ──`);
    const name = (id: string) => String(startups.get(id)?.name ?? id);
    for (const a of actions) {
      report.push({ run: run.run_id, action: a });
      if (a.kind === "skip" && a.reason === "out_of_scope") continue;
      if (a.kind === "restore_startup_field") console.log(`• ${name(a.startup_id)} — ${a.field}: ${short(a.written)}  →  ${short(a.value)}`);
      else if (a.kind === "delete_round") console.log(`• ${name(a.startup_id)} — delete round ${a.round.round_type ?? "?"} ${a.round.amount_raised ?? ""} (${a.round.source_url ?? "no source"})`);
      else if (a.kind === "restore_round_field") console.log(`• ${name(a.startup_id)} — round ${a.round_id}: ${a.column} → ${short(a.value)}`);
      else console.log(`  ↷ ${name(a.startup_id)} — ${a.field}: left alone (${a.reason === "changed_since" ? "changed after the run" : "round already deleted"})`);
      if (DRY_RUN) continue;
      if (a.kind === "restore_startup_field") {
        const { error: e } = await db.from("startups").update({ [a.field]: a.value }).eq("id", a.startup_id);
        if (e) console.warn(`  ⚠️  ${e.message}`);
      } else if (a.kind === "delete_round") {
        const { error: e } = await db.from("funding_rounds").delete().eq("id", a.round_id);
        if (e) console.warn(`  ⚠️  ${e.message}`);
        await db.from("field_provenance").delete().eq("startup_id", a.startup_id).like("field", `funding_rounds.${a.round_id}.%`);
      } else if (a.kind === "restore_round_field") {
        const { error: e } = await db.from("funding_rounds").update({ [a.column]: a.value }).eq("id", a.round_id);
        if (e) console.warn(`  ⚠️  ${e.message}`);
      }
    }
    if (!DRY_RUN && FIELDS.includes("competitors")) await db.from("field_provenance").delete().eq("run_id", run.run_id).eq("field", "market.competitors");
  }

  const done = report.filter((r) => r.action.kind !== "skip");
  const kept = report.filter((r) => r.action.kind === "skip" && r.action.reason !== "out_of_scope");
  const cell = (v: unknown) => `"${String(typeof v === "string" ? v : JSON.stringify(v ?? null)).replace(/"/g, '""')}"`;
  const out = `undo_run_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  writeFileSync(out, ["run_id,startup_id,action,field,current_value,restored_value", ...report.map(({ run, action: a }) => [
    run, a.startup_id, a.kind === "skip" ? `skip:${a.reason}` : a.kind,
    a.kind === "restore_round_field" ? `funding_rounds.${a.round_id}.${a.column}` : a.kind === "delete_round" ? `funding_rounds.${a.round_id}` : a.field,
    a.kind === "restore_startup_field" ? a.written : a.kind === "delete_round" ? a.round : "",
    a.kind === "restore_startup_field" || a.kind === "restore_round_field" ? a.value : "",
  ].map(cell).join(","))].join("\n"));
  console.log(`\n${DRY_RUN ? "Would undo" : "Undone"}: ${done.length} change(s) — ${done.filter((r) => r.action.kind === "delete_round").length} round(s) deleted. Left alone (changed after the run): ${kept.length}.`);
  console.log(`Every action: ${out}`);
}

(async () => {
  if (LIST) return list();
  if (RUN_IDS.length === 0) { console.error("RUN_ID=<id> is required (LIST=true shows the runs)."); process.exit(1); }
  return undo();
})().catch((e) => { console.error(e); process.exit(1); });
