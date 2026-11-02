#!/usr/bin/env node
/**
 * scripts/field_review.ts — short dry runs over every field (owner, 2026-11-02).
 * Writes nothing to the database.
 *
 *   1. Draws 15 random companies with a website — new every run: never one an
 *      earlier review run, the pilot, the model check or the golden set drew.
 *   2. Runs the full v2 collection on each, against what is on file.
 *   3. Writes field_review/run_<n>.csv — per field, every value that WOULD be
 *      written (an empty field filled, or a new founder / round / competitor /
 *      patent / news item), with its source and quote.
 *   4. Prints, first, 3 random values of each field, numbered, for the owner to
 *      mark — the marks go to eval/field_review_tracker.csv, and
 *      scripts/field_review_status.ts says which fields are open for writing:
 *      at least 20 values marked, at least 90% of them correct (a round: its
 *      amount and its date correct).
 *
 *   npx tsx scripts/field_review.ts            # SIZE=15
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { collectCompany, newCollectStats, V2_STARTUP_COLUMNS, V2_ROUND_COLUMNS, type V2StartupRow, type V2FundingRoundRow } from "../lib/enrichment/collect.ts";
import { loadSectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { createSearchProviderState } from "../lib/enrichment/searchProviders.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { drawPilotSample, type PilotCandidate } from "../lib/enrichment/pilotSample.ts";
import { UsageMeter } from "../lib/enrichment/models.ts";
import { buildProfile } from "../worker/profile.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY are required."); process.exit(1); }
const SIZE = Number(process.env.SIZE ?? 15);
const SEED = Number(process.env.SEED ?? Date.now() % 100000);
const MODEL = process.env.ENRICH_MODEL ?? "claude-haiku-5-5";
const DIR = "field_review";
const DRAWN = join(DIR, "drawn.json");
const db = createClient(url, key, { auth: { persistSession: false } });

/** The fields, in the order of the report and of the tracker. */
export const REVIEW_FIELDS = ["hq_city", "hq_country", "founded_year", "founding_country", "office", "employee_range", "employee_count", "founder", "founder_bio", "leader", "round", "competitor", "patent", "news"] as const;
type Field = (typeof REVIEW_FIELDS)[number];
interface Value { company_id: string; company: string; field: Field; value: string; on_file: string; source_url: string; quote: string }



function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs]; let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

async function drawCompanies(): Promise<PilotCandidate[]> {
  const rows: PilotCandidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select("id, name, website, description, city, country, founded_year, founding_country, status")
      .not("website", "is", null).neq("status", "ipo").range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as PilotCandidate[]));
    if (!data || data.length < 1000) break;
  }
  const seen = new Set<string>();
  if (existsSync(DRAWN)) for (const id of JSON.parse(readFileSync(DRAWN, "utf8")) as string[]) seen.add(id);
  for (const f of ["pilot_companies.json", "model_compare_companies.json"]) {
    if (existsSync(f)) for (const c of (JSON.parse(readFileSync(f, "utf8")).companies ?? []) as Array<{ id: string }>) seen.add(c.id);
  }
  const golden = new Set((JSON.parse(readFileSync(join(__dir, "..", "eval", "golden_set.json"), "utf8")).companies as Array<{ name: string }>).map((g) => g.name.trim().toLowerCase()));
  return drawPilotSample(rows.filter((r) => !seen.has(r.id) && !golden.has(r.name.trim().toLowerCase())), { size: SIZE, minThin: 3, minIsraeli: 3, seed: SEED });
}

/** Every value this collection would write for the company, by field. */
function wouldWrite(c: Awaited<ReturnType<typeof collectCompany>>, row: V2StartupRow): Value[] {
  if (c.outcome !== "collected") return [];
  const p = buildProfile(c, row.name);
  const src = (id?: string | null) => (id ? c.sourceUrlFor(id) ?? "" : "");
  const quoteOf = (id?: string | null) => (id ? (c.sourceById.get(id)?.content ?? "").replace(/\s+/g, " ").slice(0, 200) : "");
  const usd = (n: number | null | undefined) => (n == null ? "amount not disclosed" : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : `$${+(n / 1e6).toFixed(1)}M`);
  const out: Value[] = [];
  const add = (field: Field, value: string, on_file: unknown, source_url = "", quote = "") => {
    if (!value) return;
    out.push({ company_id: row.id, company: row.name, field, value, on_file: on_file == null ? "" : String(on_file), source_url, quote: quote.replace(/\s+/g, " ").slice(0, 240) });
  };
  const fill = (field: Field, v: { value: unknown; source_url: string | null; quote: string | null } | null | undefined, onFile: unknown) => {
    if (v?.value == null || v.value === "" || (onFile != null && onFile !== "")) return; // only an empty field is filled
    add(field, String(v.value), onFile, v.source_url ?? "", v.quote ?? "");
  };
  fill("hq_city", p.overview.city, row.city);
  fill("hq_country", p.overview.country, row.country);
  fill("founded_year", p.overview.founded_year, row.founded_year);
  fill("founding_country", p.overview.founding_country, row.founding_country);
  const range = c.profile.metrics.employee_range;
  if (range && !row.employee_range) add("employee_range", range.value, row.employee_range, src(range.source_id), range.evidence_quote);
  const count = c.profile.metrics.employee_count;
  if (count && row.employee_count == null) add("employee_count", String(count.value), row.employee_count, src(count.source_id), count.evidence_quote);
  for (const o of p.overview.offices ?? []) add("office", [o.city, o.country].filter(Boolean).join(", "), "", o.source_url ?? "");
  const onFileFounders = new Set(((row.founders ?? []) as Array<{ name?: string }>).map((f) => (f.name ?? "").toLowerCase()));
  for (const f of c.profile.profile.founders ?? []) {
    if (!onFileFounders.has(f.name.toLowerCase())) add("founder", `${f.name}${f.title ? ` — ${f.title}` : ""}`, "", f.grounded_url ?? "");
    if (f.bio) add("founder_bio", `${f.name}: ${f.bio}`, "", (f.bio_source_ids ?? []).map((id) => src(id)).filter(Boolean)[0] ?? "", quoteOf(f.bio_source_ids?.[0]));
  }
  for (const l of c.profile.leadership) add("leader", `${l.name} — ${l.role}${l.bio ? ` · ${l.bio}` : ""}`, "", (l.bio_source_ids ?? []).map((id) => src(id)).filter(Boolean)[0] ?? "");
  for (const r of c.plan.inserts) {
    const original = r.amount_original != null && r.amount_currency && r.amount_currency !== "USD" ? ` (${r.amount_currency} ${r.amount_original.toLocaleString()})` : "";
    add("round", `${r.round_type} ${usd(r.amount_raised)}${original} · ${r.announcement_date ?? "no date"}${r.announcement_date_precision && r.announcement_date_precision !== "day" ? ` (${r.announcement_date_precision})` : ""}${r.lead_investor ? ` · lead ${r.lead_investor}` : ""}`, "", r.source_url ?? "");
  }
  const onFileCompetitors = new Set(((row.competitors ?? []) as Array<{ name?: string; unverified?: boolean }>).filter((x) => !x.unverified).map((x) => (x.name ?? "").toLowerCase()));
  for (const x of c.market.competitors) if (!onFileCompetitors.has(x.name.toLowerCase())) add("competitor", x.name, "", src(x.source_id), x.evidence_quote ?? x.how_it_competes);
  const onFilePatents = new Set(((row.patents ?? []) as Array<{ patent_number?: string }>).map((x) => x.patent_number));
  for (const pt of c.market.patents) if (!onFilePatents.has(pt.patent_number)) add("patent", `${pt.patent_number ?? ""} ${pt.title}`.trim(), "", pt.url ?? "");
  const onFileNews = new Set(((row.news ?? []) as Array<{ url?: string }>).map((x) => x.url));
  for (const n of c.market.news) if (!onFileNews.has(n.url)) add("news", `${n.published_date ?? "no date"} — ${n.title}`, "", n.url);
  return out;
}

(async () => {
  mkdirSync(DIR, { recursive: true });
  const runNo = readdirSync(DIR).filter((f) => /^run_\d+\.csv$/.test(f)).length + 1;
  const drawn = await drawCompanies();
  const { data: rows, error } = await db.from("startups").select(V2_STARTUP_COLUMNS).in("id", drawn.map((d) => d.id));
  if (error) throw error;
  const { data: rounds } = await db.from("funding_rounds").select(V2_ROUND_COLUMNS).in("startup_id", drawn.map((d) => d.id));
  const prev = existsSync(DRAWN) ? JSON.parse(readFileSync(DRAWN, "utf8")) as string[] : [];
  writeFileSync(DRAWN, JSON.stringify([...prev, ...drawn.map((d) => d.id)], null, 2));
  console.log(`Field review run ${runNo} — ${drawn.length} new random companies (seed ${SEED}), model ${MODEL}. Nothing is written to the database.\n`);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const taxonomy = await loadSectorTaxonomy(db);
  const meter = new UsageMeter();
  const values: Value[] = [];
  for (const row of (rows ?? []) as V2StartupRow[]) {
    console.log(`── ${row.name} (${row.website}) ──`);
    const state = createSearchProviderState();
    state.cache = openSearchCache(row.id);
    try {
      const c = await collectCompany(row, ((rounds ?? []) as V2FundingRoundRow[]).filter((r) => r.startup_id === row.id), taxonomy, {
        anthropic, models: { enrich: MODEL, profile: MODEL, funding: MODEL, market: MODEL },
        update: false, deepDive: true, techGate: true, articlesToRead: 4, verbose: false, seen: null,
        recordCost: (m, u) => meter.add(m, u),
      }, newCollectStats(), state);
      const v = wouldWrite(c, row);
      values.push(...v);
      console.log(`    → ${c.outcome}: ${v.length} value(s) would be written`);
    } catch (e) {
      console.error(`    💥  ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      state.cache?.save();
    }
  }

  // The report: every value that would be written, by field.
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cols = ["run", "company_id", "company", "field", "value", "on_file", "source_url", "quote"] as const;
  const sorted = [...values].sort((a, b) => REVIEW_FIELDS.indexOf(a.field) - REVIEW_FIELDS.indexOf(b.field));
  writeFileSync(join(DIR, `run_${runNo}.csv`), "﻿" + [cols.join(","), ...sorted.map((v) => cols.map((k) => cell(k === "run" ? String(runNo) : String(v[k as keyof Value] ?? ""))).join(","))].join("\r\n") + "\r\n");

  // First, 3 random values of each field, numbered, for the owner to mark.
  console.log(`\n${"═".repeat(62)}\nTo mark (run ${runNo}) — answer "<number> נכון" / "<number> לא נכון" (a round: amount AND date):\n`);
  let n = 0;
  const sample: Array<Value & { id: string }> = [];
  for (const f of REVIEW_FIELDS) {
    const pick = shuffle(values.filter((v) => v.field === f), SEED + REVIEW_FIELDS.indexOf(f)).slice(0, 3);
    if (!pick.length) { console.log(`[${f}] — none this run`); continue; }
    console.log(`[${f}]`);
    for (const v of pick) {
      n++; sample.push({ ...v, id: `${runNo}.${n}` });
      console.log(`  ${runNo}.${n}  ${v.company}: ${v.value.slice(0, 220)}\n        source: ${v.source_url || "—"}${v.quote ? `\n        quote: "${v.quote.slice(0, 180)}"` : ""}`);
    }
  }
  writeFileSync(join(DIR, `run_${runNo}_sample.csv`), "﻿" + ["id,field,company,value,source_url", ...sample.map((v) => [v.id, v.field, v.company, v.value, v.source_url].map(cell).join(","))].join("\r\n") + "\r\n");

  const per = REVIEW_FIELDS.map((f) => `${f} ${values.filter((v) => v.field === f).length}`).join(" · ");
  console.log(`\n${"═".repeat(62)}\nWould be written: ${values.length} value(s) — ${per}`);
  console.log(`Claude: $${meter.costUsd.toFixed(4)} ($${(meter.costUsd / Math.max(1, drawn.length)).toFixed(4)} a company) · longest prompt ${meter.maxPromptTokens.toLocaleString()} tokens · over 100K: ${meter.callsOverLong}`);
  console.log(`📝  ${DIR}/run_${runNo}.csv (all values) · ${DIR}/run_${runNo}_sample.csv (the ${sample.length} to mark)`);
})().catch((e) => { console.error(e); process.exit(1); });
