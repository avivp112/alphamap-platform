#!/usr/bin/env node
/**
 * scripts/fix_pilot_description.ts — a company's description in pilot_batch_N.json (the list's own) set to the description the database holds, written from the company's site (owner, 2026-11-24: Aperio's list
 * description was another company's). Reads the database (READS ONLY), writes only the one file, only with APPROVED_BY=aviv.
 *   BATCH=9 NAME="Aperio" npx tsx scripts/fix_pilot_description.ts            # shows old and new
 *   BATCH=9 NAME="Aperio" APPROVED_BY=aviv npx tsx scripts/fix_pilot_description.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const f = `pilot_batch_${process.env.BATCH}.json`, name = process.env.NAME ?? "";
if (!url || !key || !existsSync(f) || !name) { console.error("BATCH, NAME, SUPABASE_* and the batch file are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
(async () => {
  const j = JSON.parse(readFileSync(f, "utf8")); const list: Array<{ id: string; name: string; description?: string | null }> = Array.isArray(j) ? j : j.companies;
  const hit = list.filter((c) => c.name.toLowerCase() === name.toLowerCase());
  if (hit.length !== 1) { console.error(`${hit.length} compan(ies) named ${name} in ${f} (exactly one is needed)`); process.exit(1); }
  const { data } = await db.from("startups").select("id, name, website, description").eq("id", hit[0].id).single();
  const d = (data as { description?: string | null; website?: string | null } | null);
  if (!d?.description) { console.error("the database holds no description for it"); process.exit(1); }
  console.log(`${hit[0].name} (${d.website})\n  list:     ${(hit[0].description ?? "—").slice(0, 300)}\n  database: ${d.description.slice(0, 300)}`);
  if (process.env.APPROVED_BY !== "aviv") { console.log("\nnothing written. APPROVED_BY=aviv to write the database's description into the file."); return; }
  hit[0].description = d.description; writeFileSync(f, JSON.stringify(j, null, 2)); console.log(`\n✓ ${f}: description of ${hit[0].name} set`);
})().catch((e) => { console.error(e); process.exit(1); });
