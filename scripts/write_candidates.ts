#!/usr/bin/env node
/**
 * scripts/write_candidates.ts — the Tier 3 values of a batch go to candidate_values with their provenance (owner, 2026-11-20); nothing of them goes to startups.
 * Reads the batch's ALL_FIELDS report (the live run's pilot_report_dry.csv): every row of a candidate field (tiers.ts), with its source address, quote and the rule that made it.
 *   BATCH_NO=8 REPORT=pilot_report_dry.csv npx tsx scripts/write_candidates.ts            report only
 *   BATCH_NO=8 REPORT=pilot_report_dry.csv DRY_RUN=false npx tsx scripts/write_candidates.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { isCandidateField } from "../lib/enrichment/tiers.ts";
import { readPendingFixes } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH_NO=<n> is required"); process.exit(2); }
const report = process.env.REPORT ?? "pilot_report_dry.csv";
const [h, ...b] = parseCsv(readFileSync(report, "utf8").replace(/^﻿/, ""));
const ix = (c: string) => h.indexOf(c);
// a value already marked wrong (pending_fixes.csv) is not stored, even as a candidate
const fold = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const known = new Set(readPendingFixes().filter((f) => f.batch === batch).map((f) => `${fold(f.company)}|${f.field}|${fold(f.value)}`));
const rows = b.filter((r) => isCandidateField(r[ix("field")] ?? "") && (r[ix("after")] ?? "").trim() && r[ix("company_id")] && !known.has(`${fold(r[ix("company")] ?? "")}|${r[ix("field")]}|${fold(r[ix("after")] ?? "")}`)).map((r) => ({
  startup_id: r[ix("company_id")], field: r[ix("field")], value: r[ix("after")], source_url: r[ix("source_url")] || null, evidence_quote: r[ix("quote")] || null,
  quote_original: ix("quote_original") >= 0 ? r[ix("quote_original")] || null : null, rule: ix("rule") >= 0 ? r[ix("rule")] || null : null, batch, run_label: `batch_${batch}`,
}));
const by = new Map<string, number>(); for (const r of rows) by.set(r.field, (by.get(r.field) ?? 0) + 1);
console.log(`${rows.length} candidate value(s) in ${report}: ${[...by].map(([f, n]) => `${f} ${n}`).join(" · ")}`);
if (process.env.DRY_RUN !== "false") { console.log("report only. DRY_RUN=false writes them to candidate_values."); process.exit(0); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key);
(async () => {
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error, count } = await db.from("candidate_values").upsert(rows.slice(i, i + 200), { onConflict: "startup_id,field,value_hash,batch", ignoreDuplicates: true, count: "exact" });
    if (error) { console.error(`⛔  candidate_values: ${error.message}`); process.exit(1); }
    written += count ?? 0;
  }
  console.log(`✓ ${written} candidate value(s) written to candidate_values (startups untouched).`);
})();
