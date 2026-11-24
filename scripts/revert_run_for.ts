#!/usr/bin/env node
/**
 * scripts/revert_run_for.ts — put back the changes of ONE run for named companies only (owner, 2026-11-24: the undo of the acquired fields was right for Phenom and Rubicon Carbon and wrong for Aperio, whose row
 * is the digital pathology company Leica bought). undo_run.ts reverts a whole run; this reverts a run for the companies named. READS first (DRY_RUN is the default): each field, the value now, the value it goes back to.
 * Each field goes back only when the database still holds what the run wrote (a value changed since is left and named). The reversal is recorded in field_changes under a run of its own.
 *
 *   RUN_ID=286758c0-bce1-4ff5-b3ee-e80714e208f6 NAMES="Aperio" npx tsx scripts/revert_run_for.ts
 *   RUN_ID=… NAMES="Aperio" APPROVED_BY=aviv DRY_RUN=false npx tsx scripts/revert_run_for.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env")) config({ path: ".env" });
const DRY_RUN = process.env.DRY_RUN !== "false";
if (!DRY_RUN && process.env.APPROVED_BY !== "aviv") { console.error("⛔  Written only with APPROVED_BY=aviv DRY_RUN=false."); process.exit(1); }
const runId = process.env.RUN_ID, names = (process.env.NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!runId || !names.length) { console.error('RUN_ID=<run> and NAMES="Aperio" are required.'); process.exit(1); }
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const COLUMN_FIELDS = new Set(["status", "acquired_by", "exit_date", "brand_after_acquisition", "website"]);   // columns this script puts back; anything else of the run is listed and left

(async () => {
  let newRun: string | null = null;
  for (const nm of names) {
    const { data: cs } = await db.from("startups").select("id, name").ilike("name", nm);
    const rows = (cs ?? []) as Array<{ id: string; name: string }>;
    if (rows.length !== 1) { console.log(`✗ ${nm}: ${rows.length} compan(ies) match (exactly one is needed)`); continue; }
    const c = rows[0];
    const { data: ch } = await db.from("field_changes").select("field, old_value, new_value").eq("run_id", runId).eq("startup_id", c.id);
    const changes = (ch ?? []) as Array<{ field: string; old_value: unknown; new_value: unknown }>;
    console.log(`\n── ${c.name}: ${changes.length} change(s) in run ${runId}`);
    const patch: Record<string, unknown> = {}; const rec: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
    for (const x of changes) {
      if (!COLUMN_FIELDS.has(x.field)) { console.log(`  • ${x.field}: not a column this script puts back — left`); continue; }
      const { data: now } = await db.from("startups").select(x.field).eq("id", c.id).single();
      const cur = (now as unknown as Record<string, unknown> | null)?.[x.field];
      if (!same(cur, x.new_value)) { console.log(`  • ${x.field}: the database now holds ${JSON.stringify(cur)}, not what the run wrote (${JSON.stringify(x.new_value)}) — left`); continue; }
      console.log(`  • ${x.field}: ${JSON.stringify(cur)} → ${JSON.stringify(x.old_value ?? null)}`);
      patch[x.field] = x.old_value ?? null; rec.push({ field: x.field, old_value: cur, new_value: x.old_value ?? null });
    }
    if (DRY_RUN || !rec.length) continue;
    if (!newRun) {
      const { data: run, error } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "revert_run_for", reverted: runId, names } }).select("run_id").single();
      if (error || !run) { console.error(`could not register the run (${error?.message}) — nothing changed`); process.exit(1); }
      newRun = (run as { run_id: string }).run_id;
    }
    const e1 = await db.from("field_changes").insert(rec.map((x) => ({ startup_id: c.id, field: x.field, old_value: x.old_value, new_value: x.new_value, source_url: null, run_id: newRun })));
    if (e1.error) { console.error(`✗ ${c.name}: field_changes not recorded (${e1.error.message}) — not changed`); continue; }
    const e2 = await db.from("startups").update(patch).eq("id", c.id);
    console.log(e2.error ? `✗ ${c.name}: ${e2.error.message}` : `  ✔ put back; recorded under run ${newRun}`);
  }
  if (DRY_RUN) console.log("\nDRY_RUN — nothing changed.");
})().catch((e) => { console.error(e); process.exit(1); });
