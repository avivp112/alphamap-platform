#!/usr/bin/env node
/**
 * scripts/add_companies.ts — add companies to the database from a list of names and websites (owner, 2026-11-13).
 *
 *   FILE=companies.csv npx tsx scripts/add_companies.ts                 # dry run: the report, nothing written
 *   FILE=companies.csv DRY_RUN=false npx tsx scripts/add_companies.ts   # adds the new ones
 *
 * ADD ONLY. A company already in the database (same website domain; or the same name with another website, which is reported and not added)
 * is left exactly as it is: nothing is reset or overwritten. (scripts/import_startups_list.ts, by contrast, syncs the whole table to a master
 * list and clears matched rows by default: do not use it for adding.) The new rows carry a name and a website only; the enrichment fills the rest,
 * and they fall in the empty group (lib/enrichment/dataGroups.ts). Every row is reported with its verdict in added_companies_<date>.csv, with
 * the ids of the rows added, so they can be removed.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseList, sortRows, summaryOf, nameKey, normalizeSite } from "../lib/enrichment/addCompanies.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const FILE = process.env.FILE;
const DRY_RUN = process.env.DRY_RUN !== "false";
if (!FILE || !existsSync(FILE)) { console.error("FILE=<csv with a name and a website column> is required."); process.exit(1); }
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const { rows, problem } = parseList(readFileSync(FILE, "utf8"));
  if (problem) { console.error(`❌  ${problem}`); process.exit(1); }
  const hosts = new Set<string>(), names = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select("name, website").range(from, from + 999);
    if (error) throw error;
    for (const s of (data ?? []) as Array<{ name: string; website: string | null }>) {
      const n = normalizeSite(s.website); if (n) hosts.add(n.host);
      const k = nameKey(s.name); if (k.length >= 3) names.add(k);
    }
    if (!data || data.length < 1000) break;
  }
  const sorted = sortRows(rows, { hosts, names });
  console.log(`${DRY_RUN ? "DRY RUN — nothing is written.\n" : ""}${summaryOf(sorted).join("\n")}\n`);
  for (const s of sorted.filter((x) => x.verdict !== "new").slice(0, 60)) console.log(`  line ${String(s.line).padStart(4)}  ${s.row.name.slice(0, 40).padEnd(40)} ${s.verdict}: ${s.note}`);
  const fresh = sorted.filter((s) => s.verdict === "new");
  const ids = new Map<string, string>();
  if (!DRY_RUN) {
    for (let i = 0; i < fresh.length; i += 200) {
      const batch = fresh.slice(i, i + 200).map((s) => ({ name: s.row.name, website: s.website! }));
      // ON CONFLICT (website) DO NOTHING: even a row that appeared in the database since the check cannot be overwritten or double-written.
      const { data, error } = await db.from("startups").upsert(batch, { onConflict: "website", ignoreDuplicates: true }).select("id, website");
      if (error) { console.error(`❌  insert failed at row ${i}: ${error.message}. Nothing after this batch was written; ${ids.size} added so far.`); break; }
      for (const r of (data ?? []) as Array<{ id: string; website: string }>) ids.set(r.website, r.id);
    }
    console.log(`\n✅  ${ids.size} companies added${ids.size < fresh.length ? ` (${fresh.length - ids.size} were already there by now and were left alone)` : ""}.`);
  } else console.log(`\n${fresh.length} would be added. Run with DRY_RUN=false to add them.`);
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = `added_companies_${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(out, "﻿" + ["line,name,website,verdict,note,id", ...sorted.map((s) => [String(s.line), s.row.name, s.website ?? s.row.website ?? "", s.verdict, s.note, s.website ? ids.get(s.website) ?? "" : ""].map(cell).join(","))].join("\r\n") + "\r\n");
  console.log(`📝  ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
