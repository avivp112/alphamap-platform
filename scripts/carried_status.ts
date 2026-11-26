#!/usr/bin/env node
/**
 * scripts/carried_status.ts — stage 3, batch 9 (owner, 2026-11-23). READS ONLY, writes nothing, calls no model.
 * The core-field rows of carried_not_written.csv (remembered values the run did not write): for each, is it already in the database, is the field empty (it could be filled), or does the database hold
 * another value (the database wins)? Values in pending_fixes.csv / excluded_values.csv are left out. Prints the quantities; nothing is written until the owner says so.
 *   npx tsx scripts/carried_status.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { isWritten, type DbCompany, type ReportRow } from "../lib/enrichment/writtenCheck.ts";
import { isCoreField } from "../lib/enrichment/tiers.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });
const load = (p: string) => { if (!existsSync(p)) return [] as Array<Record<string, string>>; const [h, ...b] = parseCsv(readFileSync(p, "utf8").replace(/^﻿/, "")); return b.map((r) => Object.fromEntries(h.map((c, i) => [c, r[i] ?? ""]))); };
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const carried = load(process.env.CARRIED ?? "carried_not_written.csv").filter((r) => isCoreField(r.field));
const barred = new Set<string>();
for (const f of [process.env.PENDING ?? "pending_fixes.csv"]) for (const r of load(f)) barred.add(`${fold(r.company ?? "")}|${r.field}|${fold(r.value ?? "")}`);
for (const f of ["excluded_values.csv", "blocked_values.csv"]) for (const r of load(f)) barred.add(`${fold(r.company ?? "")}|${r.field}|${fold(r.value ?? r.after ?? "")}`);

(async () => {
  const ids = [...new Set(carried.map((r) => r.company_id))];
  const { data: secs } = await db.from("sectors").select("id, name");
  const sectorName = new Map(((secs ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
  const byId = new Map<string, DbCompany & Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 50) {
    const c = ids.slice(i, i + 50);
    const { data } = await db.from("startups").select("id, name, city, country, founded_year, description, industry, sector_id, founders, status, acquired_by, exit_date").in("id", c);
    for (const s of (data ?? []) as Array<Record<string, unknown>>) byId.set(s.id as string, { ...(s as object), sector_name: sectorName.get(s.sector_id as string) ?? null, rounds: [], headcount: [] } as never);
    const { data: rs } = await db.from("funding_rounds").select("startup_id, round_type, amount_raised, announcement_date").in("startup_id", c);
    for (const r of (rs ?? []) as Array<Record<string, unknown> & { startup_id: string }>) byId.get(r.startup_id)?.rounds.push(r as never);
  }
  const empty = (f: string, c: Record<string, unknown>) => ({ description: !c.description, hq_city: !c.city, hq_country: !c.country, founded_year: c.founded_year == null, sector: !c.sector_id, founder: !Array.isArray(c.founders) || (c.founders as unknown[]).length === 0 } as Record<string, boolean>)[f];
  const out = { inDb: [] as string[], fillable: [] as string[], conflict: [] as string[], barred: [] as string[], other: [] as string[] };
  for (const r of carried) {
    const line = `${r.company} · ${r.field}: ${r.value.slice(0, 80)}`;
    if (barred.has(`${fold(r.company)}|${r.field}|${fold(r.value)}`)) { out.barred.push(line); continue; }
    const c = byId.get(r.company_id); if (!c) { out.other.push(`${line} [company not found]`); continue; }
    const w = isWritten({ company_id: r.company_id, company: r.company, field: r.field, after: r.value, source_url: r.source_url } as ReportRow, c);
    if (w === "yes") out.inDb.push(line);
    else if (r.field === "round") out.fillable.push(`${line}  [a round: new row if none matches]`);
    else if (r.field === "founder") out.fillable.push(`${line}  [founders on file: ${Array.isArray(c.founders) ? (c.founders as Array<{ name?: string }>).map((p) => p.name).join(", ") || "none" : "none"}]`);
    else if (empty(r.field, c)) out.fillable.push(line);
    else out.conflict.push(`${line}  [database holds another value]`);
  }
  console.log(`carried_not_written.csv, core fields: ${carried.length} row(s)`);
  console.log(`  already in the database: ${out.inDb.length}\n  left out (pending_fixes / excluded / blocked): ${out.barred.length}\n  the database holds another value (it stays): ${out.conflict.length}\n  could be written (field empty, or a round/founder not on file): ${out.fillable.length}\n  other: ${out.other.length}`);
  for (const k of ["fillable", "conflict", "barred", "other"] as const) { if (out[k].length) console.log(`\n── ${k}`); for (const l of out[k]) console.log("  " + l); }
})().catch((e) => { console.error(e); process.exit(2); });
