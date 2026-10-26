#!/usr/bin/env node
/**
 * scripts/clean_market_data.ts — the 2026-10-26 run's review applied to what
 * is already stored (enrichment v2 applies the same rules as it writes):
 *
 *   competitors  one whose own explanation says partner, customer, investor
 *                or host platform is removed (lib/enrichment/competitorRelation.ts).
 *   patents      one with no patent number, or whose number and link are
 *                different patents, is removed (lib/enrichment/patents.ts).
 *                Whether the rest belong to the company cannot be checked
 *                without their sources, so companies whose patents enrichment
 *                v2 wrote get "patents" in refresh_fields: the next run takes
 *                them first and replaces the list with checked patents.
 *
 * DRY_RUN (the default) changes nothing: counts, SAMPLE=n examples, and a CSV
 * of every change (the backup of the stored values when it writes).
 *
 *   npx tsx scripts/clean_market_data.ts                 # report only
 *   SAMPLE=3 npx tsx scripts/clean_market_data.ts        # + examples
 *   DRY_RUN=false npx tsx scripts/clean_market_data.ts   # write
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { competitorRelation } from "../lib/enrichment/competitorRelation.ts";
import { numberFromUrl, patentDigits } from "../lib/enrichment/patents.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

const DRY_RUN = process.env.DRY_RUN !== "false";
const SAMPLE = Number(process.env.SAMPLE ?? 0);
const PAGE = 500;

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

type Competitor = { name?: string; how_it_competes?: string | null; [k: string]: unknown } | string;
type Patent = { title?: string; patent_number?: string | null; url?: string | null; [k: string]: unknown };
interface Row {
  id: string; name: string; competitors: Competitor[] | null; patents: Patent[] | null;
  refresh_fields: string[] | null; enriched_v2_at: string | null;
}
interface Change { id: string; name: string; field: string; reason: string; before: string; after: string }

const changes: Change[] = [];
const counts: Record<string, number> = {};
const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

function patentProblem(p: Patent): string | null {
  const fromUrl = numberFromUrl(p.url ?? undefined);
  const given = p.patent_number?.trim() || null;
  if (!given && !fromUrl) return "patent_unidentified";
  if (given && fromUrl && patentDigits(given) !== patentDigits(fromUrl)) return "patent_number_url_mismatch";
  return null;
}

(async () => {
  console.log(DRY_RUN ? "DRY_RUN — nothing is written. DRY_RUN=false to apply." : "Writing changes.");
  let read = 0, updated = 0, markedPatents = 0, unflaggedV1Patents = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("startups")
      .select("id, name, competitors, patents, refresh_fields, enriched_v2_at")
      .order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const s of data as Row[]) {
      read++;
      const patch: Record<string, unknown> = {};
      const refresh = new Set(s.refresh_fields ?? []);

      if (Array.isArray(s.competitors) && s.competitors.length) {
        const kept = s.competitors.filter((c) => {
          if (!c || typeof c === "string" || !c.name || !c.how_it_competes) return true;
          const why = competitorRelation(c.name, c.how_it_competes, s.name);
          if (!why) return true;
          bump(`competitors (${why})`);
          changes.push({ id: s.id, name: s.name, field: `competitors[${c.name}]`, reason: why, before: c.how_it_competes, after: "(removed)" });
          return false;
        });
        if (kept.length !== s.competitors.length) patch.competitors = kept;
      }

      if (Array.isArray(s.patents) && s.patents.length) {
        const kept = s.patents.filter((p) => {
          const why = patentProblem(p);
          if (!why) return true;
          bump(`patents (${why})`);
          changes.push({ id: s.id, name: s.name, field: `patents[${p.patent_number ?? p.url ?? p.title}]`, reason: why, before: `${p.title ?? ""} ${p.patent_number ?? ""} ${p.url ?? ""}`.trim(), after: "(removed)" });
          return false;
        });
        if (kept.length !== s.patents.length) patch.patents = kept;
        if (kept.length > 0) {
          if (s.enriched_v2_at && !refresh.has("patents")) { refresh.add("patents"); markedPatents++; }
          else if (!s.enriched_v2_at) unflaggedV1Patents++;
        }
      }
      if (refresh.size !== (s.refresh_fields ?? []).length) patch.refresh_fields = [...refresh];

      if (Object.keys(patch).length === 0) continue;
      updated++;
      if (!DRY_RUN) {
        const { error: uErr } = await db.from("startups").update(patch).eq("id", s.id);
        if (uErr) console.warn(`  ⚠️  ${s.name}: ${uErr.message}`);
      }
    }
    process.stdout.write(`\r  startups read: ${read}`);
  }
  console.log("");

  if (SAMPLE > 0) {
    const groups = new Map<string, Change[]>();
    for (const c of changes) groups.set(`${c.field.replace(/\[.*\]/, "[]")} · ${c.reason}`, [...(groups.get(`${c.field.replace(/\[.*\]/, "[]")} · ${c.reason}`) ?? []), c]);
    for (const [g, list] of groups) {
      console.log(`\n── ${g} (${list.length}) ──`);
      for (const c of [...list].sort(() => Math.random() - 0.5).slice(0, SAMPLE)) console.log(`• ${c.name} — ${c.field}\n  ${c.before}`);
    }
  }

  const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const out = `clean_market_data_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  writeFileSync(out, ["id,name,field,reason,before,after", ...changes.map((c) => [c.id, c.name, c.field, c.reason, c.before, c.after].map(csvCell).join(","))].join("\n"));
  console.log(`\nCompanies ${DRY_RUN ? "to change" : "changed"}: ${updated}`);
  console.log("Removed:", counts);
  console.log(`Patents to re-check on the next run (refresh_fields): ${markedPatents} companies`);
  if (unflaggedV1Patents) console.log(`Patents written by the old engine (v1), not marked: ${unflaggedV1Patents} companies`);
  console.log(`Every change: ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
