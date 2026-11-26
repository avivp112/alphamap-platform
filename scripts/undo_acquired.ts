#!/usr/bin/env node
/**
 * scripts/undo_acquired.ts — take back the acquired fields of named companies (owner, 2026-11-24: Aperio, Phenom, Rubicon Carbon — purchases that were written by mistake in batch 9).
 * The fields: status, acquired_by, exit_date, brand_after_acquisition. Each is put back to the value it had before the write that set it (the old_value of its latest field_changes row whose new value is
 * the value now); a field that has no such record is not touched and is named. The change is recorded in field_changes under a run of its own, and the field_provenance rows of the fields go.
 *
 *   NAMES="Aperio,Phenom,Rubicon Carbon" npx tsx scripts/undo_acquired.ts                      # report only (DRY_RUN)
 *   NAMES="Aperio,Phenom,Rubicon Carbon" DRY_RUN=false npx tsx scripts/undo_acquired.ts        # after the owner approved the report
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env")) config({ path: ".env" });
const DRY_RUN = process.env.DRY_RUN !== "false";
const names = (process.env.NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!names.length) { console.error('NAMES="Aperio,Phenom" is required.'); process.exit(1); }
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const FIELDS = ["status", "acquired_by", "exit_date", "brand_after_acquisition"] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

(async () => {
  let runId: string | null = null;
  for (const nm of names) {
    const { data: cs, error } = await db.from("startups").select(`id, name, website, ${FIELDS.join(", ")}`).ilike("name", nm);
    if (error) { console.error(`✗ ${nm}: ${error.message}`); continue; }
    const rows = (cs ?? []) as unknown as Array<Record<string, unknown> & { id: string; name: string; website: string | null }>;
    if (rows.length !== 1) { console.log(`✗ ${nm}: ${rows.length} compan(ies) match the name — exactly one is needed (${rows.map((r) => `${r.name} ${r.website}`).join(" | ")})`); continue; }
    const c = rows[0];
    console.log(`\n── ${c.name} (${c.website}) now: ${FIELDS.map((f) => `${f}=${JSON.stringify(c[f] ?? null)}`).join(" · ")}`);
    const patch: Record<string, unknown> = {}; const changes: Array<{ field: string; old_value: unknown; new_value: unknown }> = [];
    for (const f of FIELDS) {
      if (c[f] == null) continue;
      const { data: ch } = await db.from("field_changes").select("old_value, new_value, created_at").eq("startup_id", c.id).eq("field", f).order("created_at", { ascending: false }).limit(20);
      const hit = ((ch ?? []) as Array<{ old_value: unknown; new_value: unknown }>).find((x) => same(x.new_value, c[f]));
      if (!hit) { console.log(`  • ${f}: ${JSON.stringify(c[f])} — no field_changes record of the write; NOT touched`); continue; }
      console.log(`  • ${f}: ${JSON.stringify(c[f])} → ${JSON.stringify(hit.old_value ?? null)}`);
      patch[f] = hit.old_value ?? null; changes.push({ field: f, old_value: c[f], new_value: hit.old_value ?? null });
    }
    if (!changes.length) continue;
    if (DRY_RUN) continue;
    if (!runId) {
      const { data: run, error: runErr } = await db.from("enrichment_runs").insert({ pipeline: "v2", run_kind: "on_demand", dry_run: false, thresholds: { MODE: "undo_value", what: "acquired fields written by mistake", names } }).select("run_id").single();
      if (runErr || !run) { console.error(`could not register the run (${runErr?.message}) — nothing changed, since it could not be recorded`); process.exit(1); }
      runId = (run as { run_id: string }).run_id;
    }
    const { error: chErr } = await db.from("field_changes").insert(changes.map((x) => ({ startup_id: c.id, field: x.field, old_value: x.old_value, new_value: x.new_value, source_url: null, run_id: runId })));
    if (chErr) { console.error(`✗ ${c.name}: field_changes not recorded (${chErr.message}) — nothing changed`); continue; }
    const { error: upErr } = await db.from("startups").update(patch).eq("id", c.id);
    if (upErr) { console.error(`✗ ${c.name}: ${upErr.message}`); continue; }
    await db.from("field_provenance").delete().eq("startup_id", c.id).in("field", Object.keys(patch));
    console.log(`  ✔ put back; recorded under run ${runId}`);
  }
  if (DRY_RUN) console.log("\nDRY_RUN — nothing changed. DRY_RUN=false to put the values back.");
})().catch((e) => { console.error(e); process.exit(1); });
