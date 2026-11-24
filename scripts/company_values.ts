#!/usr/bin/env node
/**
 * scripts/company_values.ts — what the database holds for a company and where each value came from (READS ONLY; owner, 2026-11-24: Aperio, a company of another with the same name).
 * The company's columns, and every field_provenance row (field, value, source, the start of the quote). BAD="aperio\.com|leica|patholog" marks the rows whose source or quote match it with ⚠️.
 *   NAMES="Aperio" BAD="aperio\.com|leica|patholog" npx tsx scripts/company_values.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync } from "fs";

if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const names = (process.env.NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const bad = process.env.BAD ? new RegExp(process.env.BAD, "i") : null;
if (!names.length) { console.error('NAMES="Aperio" is required.'); process.exit(1); }
(async () => {
  for (const nm of names) {
    const { data: cs } = await db.from("startups").select("*").ilike("name", nm);
    for (const c of (cs ?? []) as Array<Record<string, unknown> & { id: string }>) {
      console.log(`\n══════ ${c.name} (${c.id})`);
      for (const [k, v] of Object.entries(c)) { if (v == null || v === "" || (Array.isArray(v) && !v.length) || /embedding|created_at|updated_at/.test(k)) continue; console.log(`  ${k}: ${JSON.stringify(v).slice(0, 220)}`); }
      const { data: ps } = await db.from("field_provenance").select("field, value, source_url, evidence_quote").eq("startup_id", c.id).order("field");
      console.log(`\n  provenance (${ps?.length ?? 0} rows):`);
      for (const p of (ps ?? []) as Array<{ field: string; value: unknown; source_url: string | null; evidence_quote: string | null }>) {
        const hit = bad && (bad.test(p.source_url ?? "") || bad.test(p.evidence_quote ?? "") || bad.test(JSON.stringify(p.value ?? "")));
        console.log(`  ${hit ? "⚠️ " : "   "}${p.field}: ${JSON.stringify(p.value).slice(0, 110)} ← ${p.source_url ?? "—"}${p.evidence_quote ? `\n        "${p.evidence_quote.replace(/\s+/g, " ").slice(0, 160)}"` : ""}`);
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
