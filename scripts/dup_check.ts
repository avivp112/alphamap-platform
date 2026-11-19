#!/usr/bin/env node
/**
 * scripts/dup_check.ts — companies listed twice in not_enriched.csv (Defendology, Oiti Technologies in batch 8): two rows of startups, or one run reported twice (the 10-minute timeout reports an error
 * and the run that went on reports its own result later)? Prints the startups rows of each. Read only.
 *   npx tsx scripts/dup_check.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
(async () => {
  const [h, ...b] = parseCsv(readFileSync("not_enriched.csv", "utf8"));
  const count = new Map<string, string[]>();
  for (const r of b) (count.get(r[h.indexOf("company")]) ?? count.set(r[h.indexOf("company")], []).get(r[h.indexOf("company")])!).push(r[h.indexOf("why")]);
  for (const [name, whys] of count) {
    if (whys.length < 2) continue;
    const { data } = await db.from("startups").select("id, name, website, status, created_at").ilike("name", name);
    console.log(`${name}: listed ${whys.length}× (${whys.join(", ")}) — ${data?.length ?? 0} row(s) in startups`);
    for (const r of (data ?? []) as Array<{ id: string; name: string; website: string | null; status: string | null; created_at: string }>) console.log(`   ${r.id} ${r.website} status=${r.status} created ${r.created_at.slice(0, 10)}`);
  }
})();
