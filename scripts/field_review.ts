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
 *   4. Prints, first, random values of each field — up to 8 of a simple field (HQ city /
 *      country, founded year, founding country, offices), up to 5 of a complex one — numbered, for the owner to
 *      mark — the marks go to eval/field_review_tracker.csv, and
 *      scripts/field_review_status.ts says which fields are open for writing:
 *      at least 20 values marked, at least 90% of them correct (a round: its
 *      amount and its date correct).
 *
 *   npx tsx scripts/field_review.ts            # SIZE=15
 *   ONLY_FIELDS=description PER_FIELD=25 SIZE=30 FOCUS=description npx tsx scripts/field_review.ts   # 25 descriptions to mark in one run
 */

import { maxArticles } from "../lib/enrichment/articleBudget.ts";
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
import { drawReviewSample, targetedCount, restrictCandidates, FOCUS_FIELDS, type PilotCandidate } from "../lib/enrichment/pilotSample.ts";
import { UsageMeter } from "../lib/enrichment/models.ts";
import { buildProfile } from "../worker/profile.ts";
import { profileSourceAllowed, roundSourceStanding } from "../lib/enrichment/roundSources.ts";
import { capPerCompany, PER_COMPANY } from "../lib/enrichment/fieldReview.ts";
import { majorPressNote } from "../lib/enrichment/unlistedDomains.ts";
import { definitionLines } from "../lib/enrichment/reviewDefinitions.ts";
import { coverageReport, type CompetitorLists } from "../lib/enrichment/competitorCoverage.ts";
import { REVIEW_FIELDS, wouldWrite, type Field, type Value } from "../lib/enrichment/reviewValues.ts";

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




function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs]; let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

async function drawCompanies(): Promise<PilotCandidate[]> {
  const rows: PilotCandidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("startups").select("id, name, website, description, city, country, founded_year, founding_country, status, founders, competitors, leadership, patents, sector_id, employee_count, employee_range")
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
  // Companies an allowed press source covers: a round on file whose source is allowed.
  const covered = new Set<string>();
  const roundCount = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("funding_rounds").select("startup_id, source_url").not("source_url", "is", null).range(from, from + 999);
    if (error) throw error;
    for (const r of (data ?? []) as Array<{ startup_id: string; source_url: string }>) {
      roundCount.set(r.startup_id, (roundCount.get(r.startup_id) ?? 0) + 1);
      if (roundSourceStanding(r.source_url).kind === "allowed") covered.add(r.startup_id);
    }
    if (!data || data.length < 1000) break;
  }
  // FOCUS=competitors,rounds,patents,leadership,founded_year,founding_country,hq,founders points the
  // targeted share at companies short of those fields (owner, 2026-11-05).
  const FOCUS = (process.env.FOCUS ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  const unknownFocus = FOCUS.filter((f) => !(f in FOCUS_FIELDS));
  if (unknownFocus.length) { console.error(`FOCUS: unknown field(s) ${unknownFocus.join(", ")} — use ${Object.keys(FOCUS_FIELDS).join(", ")}.`); process.exit(1); }
  const withRounds = rows.map((r) => ({ ...r, rounds_on_file: roundCount.get(r.id) ?? 0 }));
  // MIN_ROUNDS=3 and/or PRESS_ONLY=true draw only companies a rival can be found for (funded, covered by allowed press).
  const minRounds = Number(process.env.MIN_ROUNDS ?? 0), pressOnly = process.env.PRESS_ONLY === "true";
  const pool = restrictCandidates(withRounds.filter((r) => !seen.has(r.id) && !golden.has(r.name.trim().toLowerCase())), covered, { minRounds, pressOnly });
  if (minRounds || pressOnly) console.log(`Pool narrowed${minRounds ? ` to ≥${minRounds} rounds on file` : ""}${pressOnly ? `${minRounds ? " and" : " to"} companies an allowed press source covers` : ""}: ${pool.length} companies.`);
  const sample = drawReviewSample(pool, covered, { size: SIZE, targeted: targetedCount(SIZE), seed: SEED, focus: FOCUS });
  console.log(`Draw: ${sample.filter((c) => c.why.includes("targeted")).length} targeted (${FOCUS.length ? `short of ${FOCUS.join(", ")}` : "fields short of marks"}), ${sample.filter((c) => !c.why.includes("targeted")).length} random.`);
  return sample;
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
  const coverageLists: CompetitorLists[] = [];
  const roleChecks: NonNullable<ReturnType<typeof newCollectStats>["roleChecks"]> = [];
  const unlistedSeen = new Map<string, string>();   // domains on no list that a source came from (roundSources.ts)
  for (const row of (rows ?? []) as V2StartupRow[]) {
    console.log(`── ${row.name} (${row.website}) ──`);
    const state = createSearchProviderState();
    state.cache = openSearchCache(row.id);
    const stats = newCollectStats();
    try {
      const c = await collectCompany(row, ((rounds ?? []) as V2FundingRoundRow[]).filter((r) => r.startup_id === row.id), taxonomy, {
        anthropic, models: { enrich: MODEL, profile: MODEL, funding: MODEL, market: MODEL },
        update: false, deepDive: true, techGate: true, articlesToRead: maxArticles(), verbose: false, seen: null,
        recordCost: (m, u) => meter.add(m, u),
      }, stats, state);
      roleChecks.push(...(stats.roleChecks ?? []));
      const v = wouldWrite(c, row);
      values.push(...v);
      if (c.outcome === "collected") coverageLists.push({ onFile: (row.competitors ?? []) as CompetitorLists["onFile"], found: c.market.competitors.map((x) => ({ name: x.name, tier: x.tier })) });
      console.log(`    → ${c.outcome}: ${v.length} value(s) would be written`);
      for (const d of c.unlistedDomains ?? []) unlistedSeen.set(d.domain, d.url);
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
  console.log(`What "correct" means for the newer fields:\n${definitionLines(REVIEW_FIELDS).join("\n")}\n`);
  let n = 0;
  const sample: Array<Value & { id: string }> = [];
  // Owner, 2026-11-02: simple fields up to 8 values a run, complex fields up to 5 — and, in the first
  // run, the three values of the 10-company dry run (EnerVenue, Moon Active, Ybrain).
  const SIMPLE: Field[] = ["hq_city", "hq_country", "founded_year", "founding_country", "office"];
  const carried: Value[] = runNo === 1 ? [
    { company_id: "243359ee-f289-4d31-8744-3c2264c752fa", company: "EnerVenue", field: "founding_country", value: "United States", on_file: "", source_url: "https://www.sec.gov/Archives/edgar/data/1899212/000189921221000002/primary_doc.xml", quote: "EnerVenue Holdings, Ltd. (CIK 0001899212), incorporated 2020 — related person Yi Cui" },
    { company_id: "10146787-c5ff-4c74-b375-bc6cbde3f5ca", company: "Moon Active", field: "founding_country", value: "Israel", on_file: "", source_url: "https://www.calcalistech.com/ctechnews/article/bjq8i7ffj", quote: "" },
    { company_id: "396393a1-4bf1-466b-b450-a7137877a3ce", company: "Ybrain", field: "founded_year", value: "2013", on_file: "", source_url: "https://www.prnewswire.com/news-releases/ybrains-stress-management-solution-pola-named-ces-2022-innovation-award-honoree-301426238.html", quote: "About Ybrain … founded 2013" },
  ] : [];
  // ONLY_FIELDS=description PER_FIELD=25 lists only those fields, as many values as asked (owner, 2026-11-09: 20 marks open a field in one run, not in four).
  const ONLY = (process.env.ONLY_FIELDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const PER_FIELD = Number(process.env.PER_FIELD ?? 0);
  for (const f of REVIEW_FIELDS) {
    if (ONLY.length && !ONLY.includes(f)) continue;
    const size = PER_FIELD > 0 ? PER_FIELD : SIMPLE.includes(f) ? 8 : 5;
    const pick = [...carried.filter((v) => v.field === f), ...capPerCompany(shuffle(values.filter((v) => v.field === f), SEED + REVIEW_FIELDS.indexOf(f)), PER_COMPANY).slice(0, size)];
    if (!pick.length) { console.log(`[${f}] — none this run`); continue; }
    console.log(`[${f}]`);
    for (const v of pick) {
      n++; sample.push({ ...v, id: `${runNo}.${n}` });
      console.log(`  ${runNo}.${n}  ${v.company}: ${v.value.slice(0, 220)}${v.field === "description" && v.on_file ? `\n        on file (${v.on_file.slice(0, 260)})` : ""}\n        source: ${v.source_url || "—"}${v.quote ? `\n        quote: "${v.quote.slice(0, v.field === "description" || v.field === "tags" ? 420 : 180)}"` : ""}`);
    }
  }
  writeFileSync(join(DIR, `run_${runNo}_sample.csv`), "﻿" + ["id,field,company,value,source_url", ...sample.map((v) => [v.id, v.field, v.company, v.value, v.source_url].map(cell).join(","))].join("\r\n") + "\r\n");

  const per = REVIEW_FIELDS.map((f) => `${f} ${values.filter((v) => v.field === f).length}`).join(" · ");
  console.log(`\n${"═".repeat(62)}\nWould be written: ${values.length} value(s) — ${per}`);
  // The leaders' title rule (owner, 2026-11-03): how much it costs.
  if (unlistedSeen.size) {
    console.log(`Unlisted source domains this run (${unlistedSeen.size}): ${[...unlistedSeen.keys()].slice(0, 12).join(", ")}${unlistedSeen.size > 12 ? ", …" : ""}`);
    const press = majorPressNote([...unlistedSeen.keys()]);
    if (press) console.log(`🗞️   ${press}`);
  }
  const by = (o: string) => roleChecks.filter((r) => r.outcome === o);
  const lost = [...by("kept_without_title"), ...by("dropped")];
  console.log(`Leaders' titles: ${roleChecks.length} checked — ${by("verified_card").length} verified on the site's card, ${by("verified_text").length} beside the name in a source, ${by("kept_without_title").length} kept as "Leadership team", ${by("dropped").length} dropped`);
  for (const r of shuffle(lost, SEED).slice(0, 5)) console.log(`    · ${r.company}: ${r.name} — "${r.title}" → ${r.outcome === "dropped" ? "dropped" : "Leadership team"}${r.page ? ` (${r.page})` : ""}`);
  // The cards, a separate line (owner, 2026-11-03): their first test against real sites.
  console.log(`Team-page cards: ${roleChecks.filter((r) => r.card && !r.card.startsWith("not named")).length} leader(s) named on the site's pages — ${by("verified_card").length} verified by their card; ${roleChecks.filter((r) => r.card?.startsWith("no HTML")).length} without HTML, ${roleChecks.filter((r) => r.card?.startsWith("no card")).length} without a card found, ${roleChecks.filter((r) => r.card?.includes("without the title")).length} with a card lacking the title`);
  for (const r of roleChecks.filter((x) => x.card && !x.card.startsWith("not named")).slice(0, 8)) console.log(`    · ${r.company}: ${r.name} ("${r.title}") — ${r.card}`);
  console.log(`\n${coverageReport(coverageLists).join("\n")}`);
  console.log(`Claude: $${meter.costUsd.toFixed(4)} ($${(meter.costUsd / Math.max(1, drawn.length)).toFixed(4)} a company) · longest prompt ${meter.maxPromptTokens.toLocaleString()} tokens · over 100K: ${meter.callsOverLong}`);
  console.log(`📝  ${DIR}/run_${runNo}.csv (all values) · ${DIR}/run_${runNo}_sample.csv (the ${sample.length} to mark)`);
})().catch((e) => { console.error(e); process.exit(1); });
