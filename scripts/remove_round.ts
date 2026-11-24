#!/usr/bin/env node
/**
 * scripts/remove_round.ts — one wrong round of a company taken out of funding_rounds (owner, 2026-11-24: Aperio's $4.5M 2018 round belongs to another company). Report only (DRY_RUN) by default; written only with
 * APPROVED_BY=aviv DRY_RUN=false: the row is deleted, its field_provenance rows go, and the deletion is recorded in field_changes under a run of its own (undo_run.ts puts it back).
 *   NAME="Aperio" ROUND_ID=6d5ccdd7-b9f4-4a52-87ff-9e4f1813c5e2 npx tsx scripts/remove_round.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";
import { roundDeleteChange } from "../lib/enrichment/runChanges.ts";
if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN !== "false", name = process.env.NAME ?? "", roundId = process.env.ROUND_ID ?? "";
if (!url || !key || !name || !roundId) { console.error("NAME, ROUND_ID and SUPABASE_* are required."); process.exit(1); }
if (!DRY_RUN && process.env.APPROVED_BY !== "aviv") { console.error("⛔  Written only with APPROVED_BY=aviv DRY_RUN=false."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
(async () => {
  const { data: cs } = await db.from("startups").select("id, name, website").ilike("name", name);
  const rows = (cs ?? []) as Array<{ id: string; name: string; website: string | null }>;
  if (rows.length !== 1) { console.error(`${rows.length} compan(ies) match ${name} (exactly one is needed)`); process.exit(1); }
  const c = rows[0];
  const { data: r } = await db.from("funding_rounds").select("*").eq("id", roundId).eq("startup_id", c.id).maybeSingle();
  if (!r) { console.error(`no round ${roundId} of ${c.name}`); process.exit(1); }
  const row = r as Record<string, unknown>;
  const { data: ps } = await db.from("field_provenance").select("field, source_url, evidence_quote").eq("startup_id", c.id).like("field", `funding_rounds.${roundId}.%`);
  console.log(`${c.name} (${c.website}) · round ${row.round_type ?? "?"} ${row.amount_raised ?? "?"} · ${row.announcement_date ?? "no date"} · lead ${row.lead_investor ?? "—"} · source ${row.source_url ?? "—"}`);
  for (const p of (ps ?? []) as Array<{ field: string; source_url: string | null; evidence_quote: string | null }>) console.log(`   ${p.field.split(".").pop()} ← ${p.source_url}\n      "${(p.evidence_quote ?? "").slice(0, 160)}"`);
  if (DRY_RUN) { console.log("\nDRY_RUN — nothing changed."); return; }
  const { data: run, error } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "remove_round", name, round_id: roundId } }).select("run_id").single();
  if (error || !run) { console.error(`could not register the run (${error?.message}) — nothing changed`); process.exit(1); }
  const runId = (run as { run_id: string }).run_id;
  const ch = await db.from("field_changes").insert(roundDeleteChange(c.id, roundId, row, runId)); if (ch.error) { console.error(`field_changes not recorded (${ch.error.message}) — nothing changed`); process.exit(1); }
  const del = await db.from("funding_rounds").delete().eq("id", roundId); if (del.error) { console.error(del.error.message); process.exit(1); }
  await db.from("field_provenance").delete().eq("startup_id", c.id).like("field", `funding_rounds.${roundId}.%`);
  console.log(`✔ round removed; recorded under run ${runId}`);
})().catch((e) => { console.error(e); process.exit(1); });
