#!/usr/bin/env node
/**
 * scripts/show_company.ts — columns of a company as the database holds them now. READS ONLY.
 *   NAME=Hibank COLS=offices,city,country npx tsx scripts/show_company.ts      (ID=<uuid> instead of NAME for one company; several companies of a name are all shown)
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const cols = (process.env.COLS ?? "city,country,founded_year,offices").split(",").map((c) => c.trim()).filter(Boolean);
(async () => {
  let q = db.from("startups").select(["id", "name", ...cols].join(", "));
  q = process.env.ID ? q.eq("id", process.env.ID) : q.ilike("name", process.env.NAME ?? "");
  const { data, error } = await q.limit(10);
  if (error) { console.error(error.message); process.exit(2); }
  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) { console.log(`── ${r.name} (${r.id})`); for (const c of cols) console.log(`  ${c}: ${JSON.stringify(r[c])?.slice(0, 600)}`); }
})();
