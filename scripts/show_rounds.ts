#!/usr/bin/env node
/**
 * scripts/show_rounds.ts — what the database holds for a company's rounds: each round (type, amount, date, lead, the source it rests on) and the evidence rows (quote and source) behind its fields. READS ONLY.
 *   NAMES="Kry,Weezy,Lendo" npx tsx scripts/show_rounds.ts
 */
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
(async () => {
  for (const nm of (process.env.NAMES ?? "Kry,Weezy,Lendo").split(",").map((x) => x.trim()).filter(Boolean)) {
    const { data: cs } = await db.from("startups").select("id, name, website, status").ilike("name", nm);
    for (const c of (cs ?? []) as Array<{ id: string; name: string; website: string | null; status: string | null }>) {
      console.log(`\\n======= ${c.name} (${c.website}) status=${c.status}`);
      const { data: rs } = await db.from("funding_rounds").select("id, round_type, amount_raised, amount_original, amount_currency, announcement_date, lead_investor, source_url, created_at").eq("startup_id", c.id).order("announcement_date");
      for (const r of (rs ?? []) as Array<Record<string, unknown>>) {
        console.log(`• ${r.round_type} ${r.amount_raised ?? "?"}${r.amount_currency ? ` (${r.amount_currency} ${r.amount_original})` : ""} · ${r.announcement_date ?? "no date"} · lead ${r.lead_investor ?? "—"} · written ${String(r.created_at).slice(0, 10)}\\n    source: ${r.source_url ?? "—"}`);
        const { data: ps } = await db.from("field_provenance").select("field, value, source_url, evidence_quote, created_at").eq("startup_id", c.id).like("field", `funding_rounds.${r.id}.%`);
        for (const p of (ps ?? []) as Array<Record<string, unknown>>) console.log(`    ${String(p.field).split(".").pop()}: ${JSON.stringify(p.value)} ← ${p.source_url}\\n       "${String(p.evidence_quote ?? "").replace(/\\s+/g, " ").slice(0, 260)}"`);
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(2); });
