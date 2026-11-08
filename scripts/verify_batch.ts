#!/usr/bin/env node
/**
 * scripts/verify_batch.ts — after a wet batch: does every value it wrote have its source on file? (owner, 2026-11-08)
 * READS ONLY. The batch CSV numbers the values; field_provenance holds the run's rows.
 *
 *   BATCH=field_review/batch_7.csv RUN_ID=<run id> npx tsx scripts/verify_batch.ts
 *
 * Exits 1 when a value has no provenance row (or a row with no source URL).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "fs";
import { parseCsvText } from "../lib/enrichment/fieldReview.ts";
import { checkBatchProvenance, renderProvenanceReport, type BatchRow, type ProvRow } from "../lib/enrichment/batchProvenance.ts";

const path = process.env.BATCH;
const runId = process.env.RUN_ID;
if (!path || !existsSync(path) || !runId) { console.error("BATCH=<batch csv> and RUN_ID=<run id> are required."); process.exit(1); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const [head, ...rows] = parseCsvText(readFileSync(path, "utf8").replace(/^﻿/, ""));
  const at = (n: string) => head.indexOf(n);
  const values: BatchRow[] = rows.map((r) => ({ id: r[at("id")], field: r[at("field")], company: r[at("company")], company_id: r[at("company_id")] ?? "", value: r[at("value")], source_url: r[at("source_url")] }));
  const prov: ProvRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("field_provenance").select("startup_id, field, source_url, run_id").eq("run_id", runId).range(from, from + 999);
    if (error) throw new Error(`field_provenance: ${error.message}`);
    prov.push(...((data ?? []) as ProvRow[]));
    if (!data || data.length < 1000) break;
  }
  const { count } = await db.from("field_changes").select("*", { count: "exact", head: true }).eq("run_id", runId);
  console.log(`Run ${runId}: ${prov.length} provenance row(s), ${count ?? 0} field_changes row(s) (the undo log).\n`);
  const checks = checkBatchProvenance(values, prov);
  console.log(renderProvenanceReport(checks, runId));
  if (checks.some((c) => c.status === "missing" || c.status === "no_source")) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
