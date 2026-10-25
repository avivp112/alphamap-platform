#!/usr/bin/env node
/**
 * scripts/clean_narratives.ts — applies the 2026-10-25 text rule to what is
 * already stored (lib/enrichment/narrative.ts; new enrichment applies it as
 * it writes, and the site applies it on display).
 *
 * A company's description, value proposition, founder / executive bios and
 * each competitor's "how it competes" lose the clauses that say where a fact
 * was read or name a data platform ("listed as a top competitor in Tracxn and
 * CB Insights comparisons" — platforms per lib/enrichment/dataPlatforms.ts).
 * A company's own competitors are NOT removed. VC / PE firm descriptions get
 * the same rule. Nothing is rephrased.
 *
 * DRY_RUN (the default) changes nothing: it prints counts and writes a CSV of
 * every change (table, id, name, field, before, after) to review. With
 * DRY_RUN=false it writes the same changes, and the CSV is the backup of the
 * text before them. A description or value proposition with nothing left is
 * NOT emptied (owner, 2026-10-25): it is kept, the site hides the offending
 * clauses, and the field goes into startups.refresh_fields so the next v2
 * run writes a clean one (migration 20261106000000 first). A firm
 * description with nothing left is only reported.
 *
 *   npx tsx scripts/clean_narratives.ts                 # report only
 *   SAMPLE=10 npx tsx scripts/clean_narratives.ts       # + 10 random examples per field and reason
 *   DRY_RUN=false npx tsx scripts/clean_narratives.ts   # write
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env).
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { existsSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { cleanNarrativeWithReasons, type NarrativeOptions } from "../lib/enrichment/narrative.ts";

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

interface Change { table: string; id: string; name: string; field: string; before: string; after: string; reasons: string }
const changes: Change[] = [];
const markedForRefresh: Record<string, number> = {};
const firmLeftAsIs: string[] = [];
let lastReasons = "";
/** cleanNarrative, remembering why — the reasons go on the next recorded change. */
function cleanNarrative(text: string | null | undefined, opts: NarrativeOptions = {}): string {
  const r = cleanNarrativeWithReasons(text, opts);
  lastReasons = [...new Set(r.reasons)].join("+");
  return r.text;
}
const record = (c: Omit<Change, "reasons">) => changes.push({ ...c, reasons: lastReasons });

type Person = { name?: string; bio?: string | null; [k: string]: unknown };
type Competitor = { name?: string; how_it_competes?: string | null; [k: string]: unknown } | string;

function cleanPeople(list: Person[] | null, table: string, id: string, name: string, field: string): Person[] | null {
  if (!Array.isArray(list)) return null;
  let changed = false;
  const out = list.map((p) => {
    if (!p || typeof p !== "object" || !p.bio) return p;
    const bio = cleanNarrative(p.bio);
    if (bio === p.bio) return p;
    changed = true;
    record({ table, id, name, field: `${field}[${p.name ?? "?"}].bio`, before: p.bio, after: bio });
    return { ...p, bio: bio || null };
  });
  return changed ? out : null;
}

async function startups(): Promise<number> {
  let updated = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("startups")
      .select("id, name, description, value_proposition, competitors, founders, leadership, refresh_fields")
      .order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const s of data as Array<{ id: string; name: string; description: string | null; value_proposition: string | null; competitors: Competitor[] | null; founders: Person[] | null; leadership: Person[] | null; refresh_fields: string[] | null }>) {
      const patch: Record<string, unknown> = {};
      const refresh = new Set(s.refresh_fields ?? []);
      for (const field of ["description", "value_proposition"] as const) {
        const before = s[field];
        if (!before) continue;
        const after = cleanNarrative(before, { selfName: s.name });
        if (after === before) continue;
        record({ table: "startups", id: s.id, name: s.name, field, before, after });
        if (after) { patch[field] = after; continue; }
        // Nothing left: keep it, and collect it again on the next run.
        markedForRefresh[field] = (markedForRefresh[field] ?? 0) + 1;
        refresh.add(field);
      }
      if (Array.isArray(s.competitors)) {
        let changed = false;
        const competitors = s.competitors.map((c) => {
          if (!c || typeof c === "string" || !c.how_it_competes) return c;
          const how = cleanNarrative(c.how_it_competes, { selfName: s.name, subjectName: c.name });
          if (how === c.how_it_competes) return c;
          record({ table: "startups", id: s.id, name: s.name, field: `competitors[${c.name ?? "?"}].how_it_competes`, before: c.how_it_competes, after: how });
          // Nothing left: keep it (the site shows the competitor without it) and collect again.
          if (!how) { markedForRefresh.competitors = (markedForRefresh.competitors ?? 0) + 1; refresh.add("competitors"); return c; }
          changed = true;
          return { ...c, how_it_competes: how };
        });
        if (changed) patch.competitors = competitors;
      }
      if (refresh.size !== (s.refresh_fields ?? []).length) patch.refresh_fields = [...refresh];
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
      if (after === f.description) continue;
      record({ table: "investors", id: f.id, name: f.name, field: "description", before: f.description, after });
      if (!after) { firmLeftAsIs.push(f.name); continue; }
      updated++;
      if (!DRY_RUN) {
        const { error: uErr } = await db.from("investors").update({ description: after }).eq("id", f.id);
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
  writeFileSync(out, ["table,id,name,field,reasons,before,after", ...changes.map((c) => [c.table, c.id, c.name, c.field, c.reasons, c.before, c.after].map(csvCell).join(","))].join("\n"));
  const byField: Record<string, number> = {};
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    const f = c.field.replace(/\[.*?\]/, "[]");
    byField[`${f} (${c.reasons})`] = (byField[`${f} (${c.reasons})`] ?? 0) + 1;
    const g = `${f} · ${c.reasons}`;
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  if (SAMPLE > 0) {
    for (const [g, list] of groups) {
      console.log(`\n── ${g} (${list.length}) ──`);
      for (const c of [...list].sort(() => Math.random() - 0.5).slice(0, SAMPLE)) {
        console.log(`• ${c.name}\n  BEFORE: ${c.before}\n  AFTER:  ${c.after || "(empty)"}`);
      }
    }
  }
  console.log(`\nCompanies ${DRY_RUN ? "to change" : "changed"}: ${s} · VC/PE firms: ${i}`);
  console.log("Changes by field:", byField);
  if (Object.keys(markedForRefresh).length) console.log("Nothing left — kept as is and marked for re-enrichment (refresh_fields):", markedForRefresh);
  if (firmLeftAsIs.length) console.log("Firm descriptions with nothing left — kept as is:", firmLeftAsIs.join(", "));
  console.log(`Every change, before and after: ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
