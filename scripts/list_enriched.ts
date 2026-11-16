#!/usr/bin/env node
/**
 * scripts/list_enriched.ts — put enriched companies on the platform (owner, round 10). The Private Market lists a company when startups.enriched_v2_at is set (a description written by
 * a v2 run) or when its description and completeness_score >= 7 stand on their own (view startups_market, migration 20261010000000). A pilot run did not set the stamp, so the
 * ten companies of batch 5 were written and did not appear. This sets it for the companies of a report that now have a description, and refreshes the search view.
 *
 *   IDS=<id,id,…> npx tsx scripts/list_enriched.ts                 # report only (the default)
 *   IDS=$(npx tsx scripts/report_company_ids.ts) DRY_RUN=false npx tsx scripts/list_enriched.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const ids = (process.env.IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (!ids.length) { console.error("IDS=<company ids, comma-separated> is required (npx tsx scripts/report_company_ids.ts prints them)."); process.exit(1); }
const DRY_RUN = process.env.DRY_RUN !== "false";
const db = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await db.from("startups").select("id, name, description, enriched_v2_at").in("id", ids);
if (error) { console.error(error.message); process.exit(1); }
const rows = (data ?? []) as Array<{ id: string; name: string; description: string | null; enriched_v2_at: string | null }>;
const todo = rows.filter((r) => !r.enriched_v2_at && (r.description ?? "").trim().length > 0);
for (const r of rows) console.log(`${r.enriched_v2_at ? "already listed" : (r.description ?? "").trim() ? "to list      " : "no description"}  ${r.name}`);
console.log(`\n${todo.length} of ${rows.length} company(ies) ${DRY_RUN ? "would be listed" : "listed"}.`);
if (!DRY_RUN && todo.length) {
  const { error: upErr } = await db.from("startups").update({ enriched_v2_at: new Date().toISOString() }).in("id", todo.map((r) => r.id));
  if (upErr) { console.error(upErr.message); process.exit(1); }
  const { error: refErr } = await db.rpc("refresh_startups_search");
  console.log(refErr ? `⚠️  startups_search not refreshed (${refErr.message}) — the 15-minute refresh will pick it up.` : "🔄  startups_search refreshed");
}
setTimeout(() => process.exit(0), 500).unref();
