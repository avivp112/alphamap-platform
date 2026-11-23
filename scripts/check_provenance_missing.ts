#!/usr/bin/env node
/**
 * scripts/check_provenance_missing.ts — stage 1 item 6 (owner, 2026-11-23). READS ONLY.
 * Values that are missing in the startups column: does field_provenance hold a row for them? (the batch 7 acquired bug: the value had its provenance row and the column stayed empty).
 *   NAMES="Humi,Mintifi" npx tsx scripts/check_provenance_missing.ts
 */
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const names = (process.env.NAMES ?? "Humi,Mintifi,Mastertrust,Ruya,Okra,Brighte,Estimote,Conotoxia,Sami,Six Degrees").split(",").map((x) => x.trim()).filter(Boolean);
(async () => {
  for (const nm of names) {
    const { data: cs } = await db.from("startups").select("id, name, website, city, country, founded_year, status, founders").ilike("name", nm);
    for (const c of (cs ?? []) as Array<Record<string, unknown>>) {
      const { data: ps, error } = await db.from("field_provenance").select("field, value, source_url, run_id, created_at").eq("startup_id", c.id as string).order("created_at");
      if (error) { console.log(`${nm}: ${error.message}`); continue; }
      console.log(`\n${c.name} (${c.website}) city=${c.city} country=${c.country} founded=${c.founded_year} status=${c.status} founders=${c.founders ? "yes" : "null"}  · ${ps?.length ?? 0} provenance row(s)`);
      const last = new Map<string, Record<string, unknown>>();
      for (const p of (ps ?? []) as Array<Record<string, unknown>>) last.set(`${p.field}`, p);
      for (const [f, p] of last) console.log(`   ${f}: ${JSON.stringify(p.value)?.slice(0, 70)} · run ${String(p.run_id).slice(0, 8)} · ${String(p.created_at).slice(0, 16)}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(2); });
