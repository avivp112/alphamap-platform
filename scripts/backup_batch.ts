#!/usr/bin/env node
/**
 * scripts/backup_batch.ts — before a batch is written (owner, 2026-11-23, stage 3): the rows of the batch's companies in startups, funding_rounds and field_provenance, one JSON-lines file per table in
 * backups/batch_<N>_<time>/. READS ONLY. It stops with exit code 1 when a file does not hold the rows it read, so a write never starts on a backup that is not whole.
 *   BATCH_NO=10 npx tsx scripts/backup_batch.ts      (the companies of pilot_batch_<N>.json; ONLY=<id,id> narrows)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "fs";

const batch = Number(process.env.BATCH_NO);
const file = `pilot_batch_${batch}.json`;
if (!Number.isInteger(batch) || !existsSync(file)) { console.error(`BATCH_NO=<n> and ${file} are required`); process.exit(2); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const only = (process.env.ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const ids = (JSON.parse(readFileSync(file, "utf8")) as { companies: Array<{ id: string }> }).companies.map((c) => c.id).filter((id) => !only.length || only.includes(id));
const dir = `backups/batch_${batch}_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

async function rowsOf(table: string, column: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("*").in(column, chunk).order(table === "startups" ? "id" : "created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as Array<Record<string, unknown>>));
      if ((data ?? []).length < 1000) break;
    }
  }
  return out;
}

(async () => {
  mkdirSync(dir, { recursive: true });
  let bad = false;
  for (const [table, column] of [["startups", "id"], ["funding_rounds", "startup_id"], ["field_provenance", "startup_id"]] as const) {
    const rows = await rowsOf(table, column);
    const path = `${dir}/${table}.jsonl`;
    writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    const back = readFileSync(path, "utf8").split("\n").filter(Boolean).length;
    console.log(`${back === rows.length ? "✓" : "✗"} ${table}: ${rows.length} row(s) of ${ids.length} company(ies) → ${path}`);
    if (back !== rows.length) bad = true;
  }
  if (bad) { console.error("⛔  a backup file does not hold the rows that were read"); process.exit(1); }
  console.log(`backup: ${dir}`);
})().catch((e) => { console.error(e); process.exit(1); });
