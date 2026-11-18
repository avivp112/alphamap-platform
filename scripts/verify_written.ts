#!/usr/bin/env node
/**
 * scripts/verify_written.ts — every value of a wet report is in the database (owner, batch 6). READS ONLY.
 *   REPORT=pilot_report_write.csv npx tsx scripts/verify_written.ts      (exit code 1 when a value is missing)
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { checkWritten, type DbCompany, type ReportRow } from "../lib/enrichment/writtenCheck.ts";

const path = process.env.REPORT ?? "pilot_report_write.csv";
if (!existsSync(path)) { console.error(`no report at ${path}`); process.exit(2); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const [head, ...body] = parseCsv(readFileSync(path, "utf8"));
  const at = (n: string) => head.indexOf(n);
  const rows: ReportRow[] = body.map((r) => ({ company_id: r[at("company_id")] ?? "", company: r[at("company")] ?? "", field: r[at("field")] ?? "", after: r[at("after")] ?? "", source_url: r[at("source_url")] ?? "" })).filter((r) => r.company_id && r.field);
  const ids = [...new Set(rows.map((r) => r.company_id))];
  const byId = new Map<string, DbCompany>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const { data: ss, error } = await db.from("startups").select("id, city, country, founded_year, founding_country, employee_range, employee_count, description, industry, offices, founders, leadership, competitors, news, patents, status").in("id", chunk);
    if (error) throw new Error(`startups: ${error.message}`);
    const { data: rs, error: e2 } = await db.from("funding_rounds").select("startup_id, round_type, amount_raised, announcement_date").in("startup_id", chunk);
    if (e2) throw new Error(`funding_rounds: ${e2.message}`);
    const { data: hs, error: e3 } = await db.from("headcount_history").select("startup_id, employee_count, snapshot_date").in("startup_id", chunk);
    if (e3) throw new Error(`headcount_history: ${e3.message}`);
    for (const s of (ss ?? []) as Array<Record<string, unknown>>) byId.set(s.id as string, { ...(s as object), rounds: [], headcount: [] } as DbCompany);
    for (const r of (rs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(r.startup_id)?.rounds.push(r as never);
    for (const h of (hs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(h.startup_id)?.headcount.push(h as never);
  }
  const res = checkWritten(rows, byId);
  console.log(`Database vs ${path}: ${res.checked} value(s) checked, ${res.notChecked} not a column of the company (tags, founder_background…), ${res.missing.length} NOT in the database.`);
  for (const m of res.missing) console.log(`  ✗ ${m.company} · ${m.field}: ${m.after.slice(0, 90)}`);
  if (res.missing.length) process.exit(1);
  console.log("✅ every checked value of the report is in the database.");
})().catch((e) => { console.error(e); process.exit(2); });
