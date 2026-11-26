#!/usr/bin/env node
/**
 * scripts/description_conflicts.ts — rows of pilot_batch_N.json whose list description does not fit the description written from the company's site (owner, 2026-11-24: Aperio). READS ONLY, no model, free.
 * The fit is the share of the longer word list's content words (4+ letters, no common words) that both descriptions use; the rows under CUT (default 0.10) are listed, lowest first, with both texts.
 *   BATCHES=8,9 CUT=0.10 npx tsx scripts/description_conflicts.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
if (existsSync(".env")) config({ path: ".env" });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const STOP = new Set("that with from this their which they have been into also more than other such these those about company companies business provides provide offers offer platform services service solutions solution based using used help helps allows allow including include customers customer".split(" "));
const words = (t: string) => new Set((t.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)));
const fit = (a: string, b: string) => { const x = words(a), y = words(b); if (!x.size || !y.size) return null; let n = 0; for (const w of x) if (y.has(w)) n++; return n / Math.max(x.size, y.size); };
(async () => {
  const cut = Number(process.env.CUT ?? 0.1);
  for (const n of (process.env.BATCHES ?? "8,9").split(",").map(Number)) {
    const f = `pilot_batch_${n}.json`; if (!existsSync(f)) { console.log(`batch ${n}: ${f} missing`); continue; }
    const j = JSON.parse(readFileSync(f, "utf8")); const list: Array<{ id: string; name: string; description?: string | null }> = Array.isArray(j) ? j : j.companies;
    const ids = list.map((c) => c.id); const db_: Record<string, { description: string | null; website: string | null }> = {};
    for (let i = 0; i < ids.length; i += 100) { const { data } = await db.from("startups").select("id, description, website").in("id", ids.slice(i, i + 100)); for (const r of (data ?? []) as Array<{ id: string; description: string | null; website: string | null }>) db_[r.id] = r; }
    const rows = list.map((c) => ({ c, d: db_[c.id], f: c.description && db_[c.id]?.description ? fit(c.description, db_[c.id].description!) : null }));
    const comparable = rows.filter((r) => r.f != null), low = comparable.filter((r) => (r.f as number) < cut).sort((a, b) => (a.f as number) - (b.f as number));
    console.log(`\n══ batch ${n}: ${list.length} companies · ${comparable.length} with both descriptions · ${low.length} under ${cut}`);
    for (const r of low) console.log(`  ${(r.f as number).toFixed(2)}  ${r.c.name} (${r.d?.website})\n     list:    ${(r.c.description ?? "").slice(0, 160)}\n     written: ${(r.d?.description ?? "").slice(0, 160)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
