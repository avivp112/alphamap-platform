#!/usr/bin/env node
/**
 * scripts/clean_narratives.ts — applies the 2026-10-25 text rule to what is
 * already stored (lib/enrichment/narrative.ts; new enrichment applies it as
 * it writes, and the site applies it on display).
 *
 * A company's description, value proposition, founder / executive bios and
 * each competitor's "how it competes" lose the clauses that say where a fact
 * was read or name a data platform ("listed as a top competitor in Tracxn and
 * CB Insights comparisons"); a description and value proposition also lose
 * the sentences naming the company's own competitors. VC / PE firm
 * descriptions get the same platform rule. Nothing is rephrased.
 *
 * DRY_RUN (the default) changes nothing: it prints counts and writes a CSV of
 * every change (table, id, name, field, before, after) to review. With
 * DRY_RUN=false it writes the same changes, and the CSV is the backup of the
 * text before them. A text with nothing left becomes null (a missing
 * description is better than a wrong one) — counted separately.
 *
 *   npx tsx scripts/clean_narratives.ts                 # report only
 *   DRY_RUN=false npx tsx scripts/clean_narratives.ts   # write
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { cleanNarrative } from "../lib/enrichment/narrative.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "..", ".env");
if (existsSync(envPath)) config({ path: envPath });

const DRY_RUN = process.env.DRY_RUN !== "false";
const PAGE = 500;

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

interface Change { table: string; id: string; name: string; field: string; before: string; after: string }
const changes: Change[] = [];
const emptied: Record<string, number> = {};

type Person = { name?: string; bio?: string | null; [k: string]: unknown };
type Competitor = { name?: string; how_it_competes?: string | null; [k: string]: unknown } | string;

function cleanPeople(list: Person[] | null, table: string, id: string, name: string, field: string): Person[] | null {
  if (!Array.isArray(list)) return null;
  let changed = false;
  const out = list.map((p) => {
    if (!p || typeof p !== "object" || !p.bio) return p;
    const bio = cleanNarrative(p.bio);
    if (bio === p.bio.replace(/\s+/g, " ").trim()) return p;
    changed = true;
    changes.push({ table, id, name, field: `${field}[${p.name ?? "?"}].bio`, before: p.bio, after: bio });
    return { ...p, bio: bio || null };
  });
  return changed ? out : null;
}

async function startups(): Promise<number> {
  let updated = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("startups")
      .select("id, name, description, value_proposition, competitors, founders, leadership")
      .order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const s of data as Array<{ id: string; name: string; description: string | null; value_proposition: string | null; competitors: Competitor[] | null; founders: Person[] | null; leadership: Person[] | null }>) {
      const patch: Record<string, unknown> = {};
      const names = (s.competitors ?? []).map((c) => (typeof c === "string" ? c : c?.name ?? "")).filter(Boolean);
      for (const field of ["description", "value_proposition"] as const) {
        const before = s[field];
        if (!before) continue;
        const after = cleanNarrative(before, { avoidNames: names, selfName: s.name });
        if (after === before.replace(/\s+/g, " ").trim()) continue;
        changes.push({ table: "startups", id: s.id, name: s.name, field, before, after });
        if (!after) emptied[field] = (emptied[field] ?? 0) + 1;
        patch[field] = after || null;
      }
      if (Array.isArray(s.competitors)) {
        let changed = false;
        const competitors = s.competitors.map((c) => {
          if (!c || typeof c === "string" || !c.how_it_competes) return c;
          const how = cleanNarrative(c.how_it_competes, { selfName: s.name });
          if (how === c.how_it_competes.replace(/\s+/g, " ").trim()) return c;
          changed = true;
          changes.push({ table: "startups", id: s.id, name: s.name, field: `competitors[${c.name ?? "?"}].how_it_competes`, before: c.how_it_competes, after: how });
          return { ...c, how_it_competes: how };
        });
        if (changed) patch.competitors = competitors;
      }
      const founders = cleanPeople(s.founders, "startups", s.id, s.name, "founders");
      if (founders) patch.founders = founders;
      const leadership = cleanPeople(s.leadership, "startups", s.id, s.name, "leadership");
      if (leadership) patch.leadership = leadership;

      if (Object.keys(patch).length === 0) continue;
      updated++;
      if (!DRY_RUN) {
        const { error: uErr } = await db.from("startups").update(patch).eq("id", s.id);
        if (uErr) console.warn(`  ⚠️  ${s.name}: ${uErr.message}`);
      }
    }
    process.stdout.write(`\r  startups read: ${from + data.length}`);
  }
  console.log("");
  return updated;
}

async function investors(): Promise<number> {
  let updated = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("investors").select("id, name, description").order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const f of data as Array<{ id: string; name: string; description: string | null }>) {
      if (!f.description) continue;
      const after = cleanNarrative(f.description, { selfName: f.name });
      if (after === f.description.replace(/\s+/g, " ").trim()) continue;
      changes.push({ table: "investors", id: f.id, name: f.name, field: "description", before: f.description, after });
      if (!after) emptied["investors.description"] = (emptied["investors.description"] ?? 0) + 1;
      updated++;
      if (!DRY_RUN) {
        const { error: uErr } = await db.from("investors").update({ description: after || null }).eq("id", f.id);
        if (uErr) console.warn(`  ⚠️  ${f.name}: ${uErr.message}`);
      }
    }
  }
  return updated;
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

(async () => {
  console.log(DRY_RUN ? "DRY_RUN — nothing is written. DRY_RUN=false to apply." : "Writing changes.");
  const s = await startups();
  const i = await investors();
  const out = `clean_narratives_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  writeFileSync(out, ["table,id,name,field,before,after", ...changes.map((c) => [c.table, c.id, c.name, c.field, c.before, c.after].map(csvCell).join(","))].join("\n"));
  const byField: Record<string, number> = {};
  for (const c of changes) {
    const f = c.field.replace(/\[.*?\]/, "[]");
    byField[f] = (byField[f] ?? 0) + 1;
  }
  console.log(`\nCompanies ${DRY_RUN ? "to change" : "changed"}: ${s} · VC/PE firms: ${i}`);
  console.log("Changes by field:", byField);
  if (Object.keys(emptied).length) console.log("Left empty (becomes null):", emptied);
  console.log(`Every change, before and after: ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
