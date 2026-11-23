#!/usr/bin/env node
/**
 * scripts/baseline_from_db.ts — the baselines of batches 5–7 rebuilt from the database (owner, 2026-11-23). Lists first; replaces only on APPROVED_BY=aviv APPLY=1.
 * The new baseline keeps the values of the old one that the database holds (and those the check cannot judge), in the same format; a value the database does not hold — absent, or another value in the field —
 * comes out, because the baseline is meant to be what was written. The old files are copied to archive/baseline_before_db/. Nothing else is touched.
 *   BATCHES="5 6 7" npx tsx scripts/baseline_from_db.ts                      the differences
 *   APPROVED_BY=aviv APPLY=1 BATCHES="5 6 7" npx tsx scripts/baseline_from_db.ts   replaces the files
 */
import { createClient } from "@supabase/supabase-js";
import { copyFileSync, mkdirSync } from "fs";
import { loadBaseline, saveBaseline, baselinePath } from "../lib/enrichment/regressionGate.ts";
import { classifyBaseline } from "../lib/enrichment/baselineDb.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const batches = (process.env.BATCHES ?? "5 6 7").split(/[ ,]+/).map(Number).filter(Boolean);
const APPLY = process.env.APPLY === "1";
if (APPLY && process.env.APPROVED_BY !== "aviv") { console.error("⛔  A baseline is replaced only after the owner approved the differences: APPROVED_BY=aviv APPLY=1 …"); process.exit(1); }

(async () => {
  for (const n of batches) {
    const b = loadBaseline(n); if (!b) { console.log(`batch ${n}: no baseline file`); continue; }
    const { rows, ambiguous } = await classifyBaseline(db, b.values);
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    const coreValues = new Set(rows.map((r) => r.value));
    const keep = b.values.filter((v) => !coreValues.has(v) || rows.find((r) => r.value === v)!.state === "present" || rows.find((r) => r.value === v)!.state === "notChecked");
    console.log(`\\n── batch ${n} (${b.source}): ${b.values.length} value(s) · in the database ${count("present")} · another value ${count("different")} · absent ${count("absent")} · not checkable ${count("notChecked")}${ambiguous.length ? ` · same name for several companies: ${ambiguous.join(", ")}` : ""}`);
    for (const r of rows.filter((x) => x.state === "different" || x.state === "absent")) console.log(`  − ${r.state === "different" ? "other value" : "absent     "}  ${r.value.company} · ${r.value.field}: ${r.value.value.slice(0, 70)}${r.db ? `   [database: ${r.db.slice(0, 60)}]` : ""}`);
    console.log(`  → the new baseline would hold ${keep.length} value(s) (now ${b.values.length}).`);
    if (APPLY) {
      mkdirSync("archive/baseline_before_db", { recursive: true });
      copyFileSync(baselinePath(n), `archive/baseline_before_db/batch_${n}.json`);
      saveBaseline({ ...b, values: keep, source: `${b.source}; filtered to the values the database holds on ${new Date().toISOString().slice(0, 10)} (baseline_from_db.ts)` });
      console.log(`  ✓ baseline/batch_${n}.json replaced (the old one: archive/baseline_before_db/batch_${n}.json)`);
    }
  }
  if (!APPLY) console.log("\\nNothing changed. After the owner approves: APPROVED_BY=aviv APPLY=1 npx tsx scripts/baseline_from_db.ts");
})().catch((e) => { console.error(e); process.exit(2); });
