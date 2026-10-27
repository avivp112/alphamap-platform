#!/usr/bin/env node
/**
 * eval/run_eval.ts — Phase 0 measurement baseline (v2 rollout, issues 13/14).
 *
 * Runs v1's actual extraction logic (researchCompany() from
 * scripts/bulk_enrich_all.ts, imported, never duplicated) against
 * eval/golden_set.json in DRY_RUN — no writes to `startups` or
 * `funding_rounds`, ever. Compares the result field-by-field against the
 * golden values and prints precision / coverage / wrong-write-rate per
 * field, then writes eval/baseline.json.
 *
 * ── WHAT THIS DOES WRITE ─────────────────────────────────────────────────
 *   enrichment_runs    — one row describing this run (models, thresholds).
 *   enrichment_evidence — one row per company, IF (and only if) a startups
 *     row with a matching name already exists in the database (read-only
 *     lookup, no row is ever created here). Most golden-set companies will
 *     already be tracked — that's usually WHY they're in the golden set
 *     (e.g. Apex and Fresha both have known production bugs, which can only
 *     have been observed because AlphaMap already tracks them). A company
 *     with no match simply skips evidence storage; its extraction is still
 *     scored. This script never inserts a new row into `startups` — seeding
 *     dedicated eval-only company rows, if ever wanted, is a separate,
 *     explicit decision, not something to do silently from an eval run.
 *
 * ── KNOWN PHASE 0 LIMITATION ─────────────────────────────────────────────
 *   researchCompany() (v1) returns only the FINAL Claude-extracted result —
 *   it doesn't expose which of the ~9 search queries supported which field
 *   (that's exactly what issue 1 / lib/enrichment/sources.ts introduces in
 *   Phase 1). So the "evidence" this script stores for a v1 run is the
 *   aggregate research context as ONE row per company (source_id
 *   "v1-aggregate-context"), not a real per-field S1/W1 breakdown. Don't
 *   mistake this for Phase 1's evidence granularity — it's deliberately
 *   coarser, because that's genuinely all v1 can provide.
 *
 * ── PIPELINE=v2 (2026-10-20) ─────────────────────────────────────────────
 *   Runs enrichment v2's collection (lib/enrichment/collect.ts — the engine
 *   the bulk run and the check worker share) on each golden company as a
 *   company with nothing on file, and scores what v2 would WRITE for it
 *   (worker/profile.ts buildProfile applies the write stage's own rules).
 *   Nothing is written anywhere. The golden country is never passed in as a
 *   hint (it is one of the answers). Also reports cost and time per company,
 *   and Phase 1's pass/fail rules. Writes eval/v2_results.json.
 *   Search results are cached per company (cache/enrich_v2/eval-<id>.json),
 *   so a re-run after an extraction change costs only the model calls;
 *   SEARCH_CACHE=false measures a search change.
 *
 * Usage:
 *   npx tsx eval/run_eval.ts                 # v1, score only, no DB writes at all
 *   STORE_EVIDENCE=true npx tsx eval/run_eval.ts   # v1, also write enrichment_runs/enrichment_evidence
 *   PIPELINE=v2 npx tsx eval/run_eval.ts     # v2, no writes; ONLY=<golden id>[,...] for a few
 *
 * Needs the same env vars as bulk_enrich_all.ts (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SERP_KEY, TAVILY_API_KEY,
 * JINA_API_KEY) — loaded via the same initV1Context() v1 itself uses.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import {
  initV1Context, loadSectorTaxonomy, researchCompany, supabase,
  type EnrichmentResult,
} from "../scripts/bulk_enrich_all.ts";
import { collectCompany, newCollectStats } from "../lib/enrichment/collect.ts";
import { loadSectorTaxonomy as loadV2Taxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { createSearchProviderState } from "../lib/enrichment/searchProviders.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { blankRow } from "../worker/enrich.ts";
import { buildProfile } from "../worker/profile.ts";
import { cachedCallCostUsd } from "../worker/config.ts";
import {
  FIELDS, newScoreboard, pct, scoreCompany, duplicateRounds, foundedAfterFirstRound, phase1Checks,
  type GoldenSet, type GoldenCompany, type PipelineOutput, type FieldResult, type Field,
} from "./score.ts";

import { toCsv, parseCsv, mergeRows, competitorKey, COMPETITOR_COLUMNS, type SheetRow } from "./reviewSheet.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const STORE_EVIDENCE = process.env.STORE_EVIDENCE === "true";
const PIPELINE = process.env.PIPELINE === "v2" ? "v2" : "v1";
const ONLY = (process.env.ONLY ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
// v2 run settings — the bulk run's own defaults.
const ENRICH_MODEL = process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001";
const ARTICLES_TO_READ = Number(process.env.ARTICLES_TO_READ ?? 4);
const DEEP_DIVE = process.env.DEEP_DIVE !== "false";
const TECH_GATE = process.env.TECH_GATE !== "false";
const SEARCH_COST_USD = Number(process.env.SEARCH_COST_USD ?? 0.001);
const VERBOSE = process.env.VERBOSE === "true";

// ── Evidence storage (v1, best-effort, see header comment on Phase 0 limits) ──
async function findExistingStartupId(name: string): Promise<string | null> {
  const { data, error } = await supabase.from("startups").select("id").ilike("name", name).limit(1).maybeSingle();
  if (error) { console.warn(`    ⚠️  startups lookup failed for "${name}": ${error.message}`); return null; }
  return (data as { id: string } | null)?.id ?? null;
}

/** Makes the shared client throw on any write while `fn` runs: an eval must never write to production data. */
async function withoutWrites<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const guardedMethods = ["insert", "update", "upsert", "delete"] as const;
  const originalFrom = supabase.from.bind(supabase);
  (supabase as unknown as { from: typeof supabase.from }).from = ((table: string) => {
    const qb = originalFrom(table);
    for (const m of guardedMethods) {
      if (typeof (qb as unknown as Record<string, unknown>)[m] === "function") {
        (qb as unknown as Record<string, unknown>)[m] = () => {
          throw new Error(`${label} must never write to the database — blocked .${m}() on "${table}" during eval.`);
        };
      }
    }
    return qb;
  }) as typeof supabase.from;
  try { return await fn(); } finally { (supabase as unknown as { from: typeof supabase.from }).from = originalFrom; }
}

function fromV1(r: EnrichmentResult): PipelineOutput {
  return {
    city: r.profile.city ?? null, country: r.profile.country ?? null, founded_year: r.profile.founded_year ?? null,
    founders: (r.profile.founders ?? []).map((f) => ({ name: f.name })),
    rounds: (r.funding_rounds ?? []).map((x) => ({ round_type: x.round_type, amount_raised: x.amount_raised ?? null, date: x.date ?? null })),
    employee_range: r.metrics.employee_range ?? null,
    arr_usd: null,
  };
}

interface V2Run { output: PipelineOutput | null; outcome: string; costUsd: number; seconds: number; searches: number; sources: number }

async function runV2(company: GoldenCompany, anthropic: Anthropic, taxonomy: SectorTaxonomy): Promise<V2Run> {
  const started = Date.now();
  let llmCost = 0;
  const searchState = createSearchProviderState();
  searchState.cache = openSearchCache(`eval-${company.id}`);
  const row = blankRow({ checkId: `eval-${company.id}`, name: company.name, website: company.website ?? null, country: null, founder: null });
  const done = (output: PipelineOutput | null, outcome: string, sources = 0): V2Run => ({
    output, outcome, sources,
    searches: searchState.serperCallCount + searchState.tavilyCallCount,
    costUsd: llmCost + (searchState.serperCallCount + searchState.tavilyCallCount) * SEARCH_COST_USD,
    seconds: (Date.now() - started) / 1000,
  });
  try {
    const c = await collectCompany(row, [], taxonomy, {
      anthropic,
      models: { enrich: ENRICH_MODEL, profile: ENRICH_MODEL, funding: ENRICH_MODEL, market: ENRICH_MODEL },
      update: false, deepDive: DEEP_DIVE, techGate: TECH_GATE, articlesToRead: ARTICLES_TO_READ, verbose: VERBOSE, seen: null,
      recordCost: (model, usage) => { llmCost += cachedCallCostUsd(model, usage); },
    }, newCollectStats(), searchState);
    if (c.outcome !== "collected") return done(null, c.outcome);
    const p = buildProfile(c, company.name);
    const arr = [...c.funding.arr_milestones].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
    return done({
      city: p.overview.city?.value ?? null, country: p.overview.country?.value ?? null, founded_year: p.overview.founded_year?.value ?? null,
      founding_country: p.overview.founding_country?.value ?? null,
      founders: p.people.founders.map((f) => ({ name: f.name })),
      rounds: p.funding.rounds.map((r) => ({ round_type: r.round_type, amount_raised: r.amount, date: r.date })),
      employee_range: p.overview.employee_range,
      arr_usd: arr?.arr ?? null,
      competitors: c.market.competitors.map((x) => x.name),
      competitor_sources: c.market.competitors.map((x) => ({ name: x.name, source_url: c.sourceUrlFor(x.source_id), quote: x.evidence_quote ?? null })),
      // Patents come only from the EPO register: not looked up (no EPO keys) is not "none".
      patents: c.patentsFromRegister ? c.market.patents.map((x) => x.patent_number).filter((n): n is string => !!n) : undefined,
    }, "collected", p.sources_count);
  } finally {
    searchState.cache?.save();
  }
}

async function main() {
  await initV1Context();
  if (PIPELINE === "v1") await loadSectorTaxonomy();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const v2Taxonomy = PIPELINE === "v2" ? await loadV2Taxonomy(supabase) : null;

  const golden: GoldenSet = JSON.parse(readFileSync(join(__dir, "golden_set.json"), "utf8"));
  const companies = golden.companies.filter((c) => !ONLY.length || ONLY.includes(c.id.toLowerCase()) || ONLY.includes(c.name.toLowerCase()));
  const unreviewed = companies.filter((c) => !c.reviewed_by_human).length;
  console.log(`Pipeline ${PIPELINE} on ${companies.length} golden-set companies${unreviewed ? ` (${unreviewed} not yet reviewed by a human)` : ""}.\n`);

  let runId: string | null = null;
  if (STORE_EVIDENCE && PIPELINE === "v1") {
    const { data, error } = await supabase.from("enrichment_runs").insert({
      pipeline: "v1",
      dry_run: true,
      profile_model: process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001",
      funding_model: process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001",
      thresholds: { MIN_CONFIDENCE: Number(process.env.MIN_CONFIDENCE ?? 40) },
      companies_count: companies.length,
    }).select("run_id").single();
    if (error) console.warn(`⚠️  Could not create enrichment_runs row: ${error.message} — continuing without evidence storage.`);
    else runId = (data as { run_id: string }).run_id;
  }

  const board = newScoreboard();
  const perCompany: Record<string, {
    output: PipelineOutput | null; outcome?: string; fields?: Record<Field, FieldResult>;
    duplicates?: Array<[number, number]>; founded_after_round?: boolean; cost_usd?: number; seconds?: number; searches?: number;
  }> = {};
  const raw: Record<string, EnrichmentResult | null> = {};
  let locationMismatches = 0, duplicates = 0, foundedAfterRound = 0, totalCost = 0, totalSeconds = 0, ran = 0;

  for (const company of companies) {
    console.log(`── ${company.name} (${company.id}) ──`);
    let output: PipelineOutput | null = null;
    let extra: { outcome?: string; cost_usd?: number; seconds?: number; searches?: number } = {};

    if (PIPELINE === "v1") {
      let result: EnrichmentResult | null = null;
      try {
        result = await withoutWrites("researchCompany()", () => researchCompany(company.name, company.website ?? null, company.country?.value ?? null));
      } catch (err) {
        console.error(`    ❌  researchCompany threw: ${String(err)}`);
      }
      raw[company.id] = result;
      output = result ? fromV1(result) : null;
      if (STORE_EVIDENCE && runId && result) {
        const startupId = await findExistingStartupId(company.name);
        if (startupId) {
          const { error } = await supabase.from("enrichment_evidence").insert({
            run_id: runId, startup_id: startupId, source_id: "v1-aggregate-context", query_label: "v1_full_research_pass",
            provider: "serper", // best single label for v1's primary engine — see header comment
            content: JSON.stringify(result).slice(0, 50_000), kept: true,
          });
          if (error) console.warn(`    ⚠️  enrichment_evidence insert failed: ${error.message}`);
        } else {
          console.log(`    ℹ️   No existing startups row matched "${company.name}" — skipping evidence storage (extraction was still scored).`);
        }
      }
    } else {
      try {
        const r = await withoutWrites("v2 collection", () => runV2(company, anthropic, v2Taxonomy!));
        output = r.output;
        extra = { outcome: r.outcome, cost_usd: r.costUsd, seconds: r.seconds, searches: r.searches };
        totalCost += r.costUsd; totalSeconds += r.seconds; ran++;
        console.log(`    outcome=${r.outcome} · ${r.sources} sources · ${r.searches} searches · $${r.costUsd.toFixed(4)} · ${r.seconds.toFixed(0)} s`);
      } catch (err) {
        console.error(`    ❌  v2 collection threw: ${String(err)}`);
        extra = { outcome: "error" };
      }
    }

    // No output still counts: every golden value becomes "missing" (coverage drops, precision does not).
    const out: PipelineOutput = output ?? { city: null, country: null, founded_year: null, founders: [], rounds: [], employee_range: null, arr_usd: null };
    const fields = scoreCompany(board, company, out);
    const dups = duplicateRounds(out.rounds);
    const afterRound = foundedAfterFirstRound(out);
    if (fields.city === "wrong" || fields.country === "wrong") locationMismatches++;
    duplicates += dups.length;
    if (afterRound) foundedAfterRound++;
    perCompany[company.id] = { output, ...extra, fields, duplicates: dups, founded_after_round: afterRound };

    console.log(`    city="${out.city ?? "—"}" (${fields.city}) country="${out.country ?? "—"}" (${fields.country}) founded-in="${out.founding_country ?? "—"}" (${fields.founding_country}) founded=${out.founded_year ?? "—"} (${fields.founded_year})`);
    console.log(`    founders=${out.founders.map((f) => f.name).join(", ") || "—"} (${fields.founders})`);
    console.log(`    rounds=${out.rounds.length} (golden: ${(company.funding_rounds ?? []).filter((r) => r.confidence !== "unknown").length} verified; ${fields.funding_rounds})${dups.length ? ` ⚠️ ${dups.length} duplicate pair(s)` : ""}${afterRound ? " ⚠️ founded after first round" : ""}`);
    const usd = (n: number | null) => (n == null ? "?" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`);
    for (const r of out.rounds) console.log(`      · ${r.round_type} ${usd(r.amount_raised)} ${r.date ?? "(no date)"}`);
    for (const r of (company.funding_rounds ?? []).filter((g) => g.confidence !== "unknown")) console.log(`      ✓ golden: ${r.type} ${usd(r.amount_usd)} ${r.date ?? "(no date)"}`);
    console.log(`    round types (${fields.round_type}) · competitors=${out.competitors?.join(", ") || "—"} (${fields.competitors}) · patents=${out.patents?.join(", ") ?? "not looked up"} (${fields.patents})`);
    console.log("");
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log("═".repeat(62));
  console.log(`${PIPELINE === "v1" ? "PHASE 0 BASELINE — v1 (bulk_enrich_all.ts)" : "v2 (lib/enrichment/collect.ts)"} vs eval/golden_set.json`);
  console.log("═".repeat(62));
  console.log(`${"field".padEnd(16)}${"coverage".padEnd(12)}${"precision".padEnd(12)}${"wrong-write".padEnd(14)}scored`);
  const summary: Record<string, { coverage: string; precision: string; wrong_write_rate: string; scored: number }> = {};
  for (const field of FIELDS) {
    const s = board[field];
    const row = { coverage: pct(s.correct, s.scored), precision: pct(s.correct, s.produced), wrong_write_rate: pct(s.produced - s.correct, s.produced), scored: s.scored };
    console.log(`${field.padEnd(16)}${row.coverage.padEnd(12)}${row.precision.padEnd(12)}${row.wrong_write_rate.padEnd(14)}${s.scored}${s.unjudged ? `  (${s.unjudged} unjudged)` : ""}`);
    summary[field] = row;
  }
  console.log("═".repeat(62));
  const checks = phase1Checks(board, { locationMismatches, duplicateRounds: duplicates, foundedAfterRound });
  console.log("Phase 1 rules (docs/enrichment_v2_spec.md §7):");
  for (const c of checks) console.log(`  ${c.pass ? "✅" : "❌"} ${c.rule} — ${c.detail}`);
  if (PIPELINE === "v2" && ran) {
    console.log(`\nCost: $${totalCost.toFixed(3)} total, $${(totalCost / ran).toFixed(4)} per company · time: ${(totalSeconds / ran).toFixed(0)} s per company`);
  }
  if (companies.length < 50 || unreviewed) {
    console.log(`\n⚠️  ${companies.length} companies${unreviewed ? `, ${unreviewed} not yet reviewed by a human` : ""} — Phase 1 is judged only on the full,`);
    console.log("   reviewed golden set (50+). Treat these numbers as a direction, not a verdict.\n");
  }

  const file = PIPELINE === "v1" ? "baseline.json" : "v2_results.json";
  // Competitors v2 found that the golden set does not judge yet, for the
  // companies under review: the owner marks them (eval/reviewSheet.ts).
  const toReview: SheetRow[] = [];
  for (const company of companies) {
    const g = company.competitors;
    const found = perCompany[company.id]?.output?.competitor_sources ?? [];
    if (!g) continue;
    const known = [...g.names, ...(g.not_competitors ?? [])].map((n) => competitorKey({ company_id: company.id, competitor: n }));
    for (const c of found) {
      const row = { company_id: company.id, company: company.name, competitor: c.name, source_url: c.source_url ?? "", quote: c.quote ?? "", mark: "" };
      if (!known.includes(competitorKey(row))) toReview.push(row);
    }
  }
  if (toReview.length) {
    const sheet = join(__dir, "review", "competitors_review.csv");
    mkdirSync(dirname(sheet), { recursive: true });
    const existing = existsSync(sheet) ? parseCsv(readFileSync(sheet, "utf8")) : [];
    const merged = mergeRows(existing, toReview, competitorKey);
    writeFileSync(sheet, toCsv(COMPETITOR_COLUMNS, merged));
    console.log(`📝  ${merged.length - existing.length} competitor(s) to mark in eval/review/competitors_review.csv ("נכון" / "לא נכון"), then: npx tsx eval/import_review.ts`);
  }

  writeFileSync(join(__dir, file), JSON.stringify({
    pipeline: PIPELINE, generated_at: new Date().toISOString(), companies_scored: companies.length, unreviewed,
    settings: PIPELINE === "v2" ? { model: ENRICH_MODEL, articles_to_read: ARTICLES_TO_READ, deep_dive: DEEP_DIVE, tech_gate: TECH_GATE } : undefined,
    fields: summary, phase1: checks,
    cost: PIPELINE === "v2" && ran ? { total_usd: totalCost, per_company_usd: totalCost / ran, seconds_per_company: totalSeconds / ran } : undefined,
    // Per company, so a human can see WHY a field scored the way it did without re-running.
    per_company: perCompany,
    raw_results: PIPELINE === "v1" ? raw : undefined,
  }, null, 2));
  console.log(`Wrote eval/${file} (pipeline: ${PIPELINE}, ${companies.length} companies).`);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
