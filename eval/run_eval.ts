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
 *   V2_COMPONENTS=baseline PIPELINE=v2 npx tsx eval/run_eval.ts   # the core alone → eval/v2_results_baseline.json
 *   V2_COMPONENTS=all PIPELINE=v2 npx tsx eval/run_eval.ts        # every component on → eval/v2_results_all.json
 *   npx tsx eval/compare_runs.ts eval/v2_results_baseline.json eval/v2_results_all.json
 *   (components: lib/enrichment/components.ts)
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
import { componentStates } from "../lib/enrichment/components.ts";
import { roundSourceStanding, hostOf } from "../lib/enrichment/roundSources.ts";
import { loadSectorTaxonomy as loadV2Taxonomy, type SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { createSearchProviderState, searchCalls } from "../lib/enrichment/searchProviders.ts";
import { openSearchCache } from "../lib/enrichment/searchCache.ts";
import { blankRow } from "../worker/enrich.ts";
import { buildProfile } from "../worker/profile.ts";
import { wrongValues, wrongValuesText, wrongValuesCsv } from "./wrongValues.ts";
import { callCostUsd, knownModel, UsageMeter, LONG_PROMPT_TOKENS } from "../lib/enrichment/models.ts";
import {
  FIELDS, newScoreboard, pct, scoreCompany, duplicateRounds, foundedAfterFirstRound, phase1Checks, hintGain, matchRounds, roundsDayGap, isFatalProviderError, isEvent,
  type GoldenSet, type GoldenCompany, type PipelineOutput, type FieldResult, type Field,
} from "./score.ts";

import { toCsv, parseCsv, mergeRows, competitorKey, roundKey, COMPETITOR_COLUMNS, ROUND_COLUMNS, type SheetRow } from "./reviewSheet.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const STORE_EVIDENCE = process.env.STORE_EVIDENCE === "true";
const PIPELINE = process.env.PIPELINE === "v2" ? "v2" : "v1";
const ONLY = (process.env.ONLY ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
// v2 run settings — the bulk run's own defaults.
const ENRICH_MODEL = process.env.ENRICH_MODEL ?? "claude-haiku-5-5"; // owner, 2026-11-02 (was claude-haiku-4-5-20251001)
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

interface V2Run { output: PipelineOutput | null; outcome: string; costUsd: number; seconds: number; searches: number; sources: number; llm?: ReturnType<UsageMeter["toJSON"]> }
/** Every Claude call of the run: tokens, cost, the longest prompt (Haiku 5.5's 100K rate card). */
const LLM = new UsageMeter();

async function runV2(company: GoldenCompany, anthropic: Anthropic, taxonomy: SectorTaxonomy): Promise<V2Run> {
  const started = Date.now();
  let llmCost = 0;
  const companyLlm = new UsageMeter();
  const searchState = createSearchProviderState();
  searchState.cache = openSearchCache(`eval-${company.id}`);
  searchState.queryLog = [];
  const row = blankRow({ checkId: `eval-${company.id}`, name: company.name, website: company.website ?? null, country: null, founder: null });
  const done = (output: PipelineOutput | null, outcome: string, sources = 0): V2Run => ({
    output, outcome, sources,
    searches: searchCalls(searchState),
    costUsd: llmCost + searchCalls(searchState) * SEARCH_COST_USD,
    llm: companyLlm.toJSON(),
    seconds: (Date.now() - started) / 1000,
  });
  try {
    const c = await collectCompany(row, [], taxonomy, {
      anthropic,
      models: { enrich: ENRICH_MODEL, profile: ENRICH_MODEL, funding: ENRICH_MODEL, market: ENRICH_MODEL },
      update: false, deepDive: DEEP_DIVE, techGate: TECH_GATE, articlesToRead: ARTICLES_TO_READ, verbose: VERBOSE, seen: null,
      // Claude's cost from the tokens each call reports (lib/enrichment/models.ts).
      recordCost: (model, usage) => { llmCost += callCostUsd(model, usage); companyLlm.add(model, usage); LLM.add(model, usage); },
    }, newCollectStats(), searchState);
    if (c.outcome !== "collected") return done(null, c.outcome);
    const p = buildProfile(c, company.name);
    const arr = [...c.funding.arr_milestones].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
    return done({
      city: p.overview.city?.value ?? null, country: p.overview.country?.value ?? null, founded_year: p.overview.founded_year?.value ?? null,
      founding_country: p.overview.founding_country?.value ?? null,
      founders: p.people.founders.map((f) => ({ name: f.name, has_bio: !!f.bio })),
      // A year-only date is scored as that year, never as January 1st (owner, 2026-10-29).
      rounds: p.funding.rounds.map((r) => ({ round_type: r.round_type, amount_raised: r.amount, date: datedAs(r.date, r.date_precision), lead_investor: r.lead_investor, source_url: r.source_url })),
      employee_range: p.overview.employee_range,
      arr_usd: arr?.arr ?? null,
      competitors: c.market.competitors.map((x) => x.name),
      competitor_sources: c.market.competitors.map((x) => ({ name: x.name, source_url: c.sourceUrlFor(x.source_id), quote: x.evidence_quote ?? null })),
      // Patents come only from the EPO register: not looked up (no EPO keys) is not "none".
      patents: c.patentsFromRegister ? c.market.patents.map((x) => x.patent_number).filter((n): n is string => !!n) : undefined,
      unlisted_domains: c.unlistedDomains ?? [],
      scalar_sources: Object.fromEntries((["city", "country", "founded_year", "founding_country"] as const).map((f) => [f, { source_url: p.overview[f]?.source_url ?? null, quote: p.overview[f]?.quote ?? null }])),
      search_log: searchState.queryLog,
      hints: {
        confirmed: (c.confirmedHints ?? []).map((h) => ({ round_type: h.round_type, amount_raised: h.amount_raised, date: h.announcement_date, source_url: h.confirmed_source_url })),
        kept: (c.roundHints ?? []).map((h) => ({ round_type: h.round_type, amount_raised: h.amount_raised, date: h.announcement_date, source_url: h.source_url })),
      },
    }, "collected", p.sources_count);
  } finally {
    searchState.cache?.save();
  }
}

const COMPONENTS = componentStates();
// EVAL_LABEL names the results file (eval/v2_results_<label>.json) — e.g. one per model on the
// same day (owner, 2026-11-02: Haiku 5.5 against Haiku 4.5); else the components setting does.
const COMPONENTS_LABEL = (process.env.EVAL_LABEL ?? process.env.V2_COMPONENTS ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "2019-01-01" stated as a year → "2019"; as a month → "2019-11": the golden set's own partial-date form. */
const datedAs = (date: string | null, precision: string | null | undefined) =>
  !date ? null : precision === "year" ? date.slice(0, 4) : precision === "month" ? date.slice(0, 7) : date;

/** A source worth the owner's check: the company's own site, or an allowed outlet of tiers 1–3. */
function reviewableSource(url: string | null | undefined, website: string | null | undefined): boolean {
  if (!url) return false;
  const domain = (website ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const standing = roundSourceStanding(url, { isCompanySite: !!domain && (hostOf(url) === domain || !!hostOf(url)?.endsWith(`.${domain}`)) });
  return standing.kind === "allowed" && standing.tier <= 3;
}

/**
 * RESCORE=true (owner, 2026-11-05): scores the output a finished run stored (eval/v2_results_<label>.json)
 * against the CURRENT golden set — no search, no model, no database, no cost. After the owner marks a
 * value or adds a company, the numbers update without paying for the run again. A company the stored
 * run does not hold is listed and skipped, never guessed.
 */
const RESCORE = process.env.RESCORE === "true";
const RESULTS_FILE = PIPELINE === "v1" ? "baseline.json" : `v2_results${COMPONENTS_LABEL ? `_${COMPONENTS_LABEL}` : ""}.json`;

async function main() {
  const stored: { per_company?: Record<string, { output: PipelineOutput | null; outcome?: string; cost_usd?: number; seconds?: number }>; generated_at?: string } | null = RESCORE
    ? (existsSync(join(__dir, RESULTS_FILE)) ? JSON.parse(readFileSync(join(__dir, RESULTS_FILE), "utf8")) : null) : null;
  if (RESCORE && !stored?.per_company) { console.error(`RESCORE=true: eval/${RESULTS_FILE} not found or holds no per-company output. Run the evaluation first (EVAL_LABEL names the file).`); process.exit(1); }
  if (!RESCORE) await initV1Context();
  if (PIPELINE === "v1" && !RESCORE) await loadSectorTaxonomy();
  const anthropic = RESCORE ? (null as unknown as Anthropic) : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const v2Taxonomy = PIPELINE === "v2" && !RESCORE ? await loadV2Taxonomy(supabase) : null;

  const golden: GoldenSet = JSON.parse(readFileSync(join(__dir, "golden_set.json"), "utf8"));
  const inSet = golden.companies.filter((c) => !ONLY.length || ONLY.includes(c.id.toLowerCase()) || ONLY.includes(c.name.toLowerCase()));
  // A company without a website does not enter the golden set (owner, 2026-11-05): searching by name
  // alone would be an unfair measurement. The import tool copies the website by company id.
  let companies = inSet.filter((c) => c.website);
  if (RESCORE) {
    const missing = companies.filter((c) => !stored!.per_company![c.id]);
    companies = companies.filter((c) => stored!.per_company![c.id]);
    console.log(`RESCORE: scoring the stored run of ${stored!.generated_at ?? "?"} (eval/${RESULTS_FILE}) against the current golden set — nothing is searched or paid for.`);
    if (missing.length) console.log(`  ${missing.length} golden compan${missing.length === 1 ? "y is" : "ies are"} not in that run and skipped: ${missing.map((c) => c.name).join(", ")}`);
  }
  for (const c of inSet.filter((x) => !x.website)) console.warn(`  ⚠️  ${c.name}: no website in the golden set — skipped. Run eval/import_field_review.ts to fill it by company id.`);
  const unreviewed = companies.filter((c) => !c.reviewed_by_human).length;
  console.log(`Pipeline ${PIPELINE} on ${companies.length} golden-set companies${unreviewed ? ` (${unreviewed} not yet reviewed by a human)` : ""}.`);
  if (PIPELINE === "v2") console.log(`Components (V2_COMPONENTS=${process.env.V2_COMPONENTS ?? "default"}): ${Object.entries(COMPONENTS).map(([n, on]) => `${n} ${on ? "on" : "off"}`).join(" · ")}`);
  console.log("");

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
    hints?: ReturnType<typeof hintGain>;
  }> = {};
  const raw: Record<string, EnrichmentResult | null> = {};
  let locationMismatches = 0, duplicates = 0, foundedAfterRound = 0, totalCost = 0, totalSeconds = 0, ran = 0;
  const hintTotals = { confirmed: 0, confirmed_matching_golden: 0, kept: 0, kept_matching_golden: 0 };
  // A round with no date is a gap the user sees too (owner, 2026-10-29).
  const roundDates = { rounds: 0, undated: 0 };
  // Does every founder written get a bio? (owner, 2026-11-01)
  const founderBios = { founders: 0, with_bio: 0 };

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
    } else if (RESCORE) {
      const st = stored!.per_company![company.id];
      output = st.output;
      extra = { outcome: st.outcome, cost_usd: st.cost_usd, seconds: st.seconds } as typeof extra;
      totalCost += st.cost_usd ?? 0; totalSeconds += st.seconds ?? 0; ran++;
    } else {
      try {
        const r = await withoutWrites("v2 collection", () => runV2(company, anthropic, v2Taxonomy!));
        output = r.output;
        extra = { outcome: r.outcome, cost_usd: r.costUsd, seconds: r.seconds, searches: r.searches, llm: r.llm } as typeof extra;
        totalCost += r.costUsd; totalSeconds += r.seconds; ran++;
        console.log(`    outcome=${r.outcome} · ${r.sources} sources · ${r.searches} searches · $${r.costUsd.toFixed(4)} · ${r.seconds.toFixed(0)} s`);
      } catch (err) {
        console.error(`    ❌  v2 collection threw: ${String(err)}`);
        // Out of credit / key rejected: every later company would fail too and
        // score as "missing" — a run of 2026-11-01 lost 25 of 32 companies that
        // way. Stop without writing results, so no broken run is ever compared.
        if (isFatalProviderError(err)) {
          console.error(`\n⛔  Stopped: a provider is out of credit or rejected its key — nothing written (eval/${PIPELINE === "v1" ? "baseline.json" : `v2_results${COMPONENTS_LABEL ? `_${COMPONENTS_LABEL}` : ""}.json`} unchanged). Top up / fix the key and run this setting again; searches already made are cached.`);
          process.exit(1);
        }
        extra = { outcome: "error" };
      }
    }

    // No output still counts: every golden value becomes "missing" (coverage drops, precision does not).
    const out: PipelineOutput = output ?? { city: null, country: null, founded_year: null, founders: [], rounds: [], employee_range: null, arr_usd: null };
    const fields = scoreCompany(board, company, out);
    const dups = duplicateRounds(out.rounds, company);
    const afterRound = foundedAfterFirstRound(out);
    if (fields.city === "wrong" || fields.country === "wrong") locationMismatches++;
    duplicates += dups.length;
    if (afterRound) foundedAfterRound++;
    roundDates.rounds += out.rounds.length;
    roundDates.undated += out.rounds.filter((r) => !r.date).length;
    const gain = hintGain(company, out.hints);
    for (const k of Object.keys(hintTotals) as Array<keyof typeof hintTotals>) hintTotals[k] += gain[k];
    perCompany[company.id] = { output, ...extra, fields, duplicates: dups, founded_after_round: afterRound, hints: gain };

    console.log(`    city="${out.city ?? "—"}" (${fields.city}) country="${out.country ?? "—"}" (${fields.country}) founded-in="${out.founding_country ?? "—"}" (${fields.founding_country}) founded=${out.founded_year ?? "—"} (${fields.founded_year})`);
    console.log(`    founders=${out.founders.map((f) => f.name).join(", ") || "—"} (${fields.founders})${out.founders.length ? ` · with a bio: ${out.founders.filter((f) => f.has_bio).length}/${out.founders.length}` : ""}`);
    founderBios.founders += out.founders.length;
    founderBios.with_bio += out.founders.filter((f) => f.has_bio).length;
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
  console.log(`${"field".padEnd(16)}${"coverage".padEnd(12)}${"precision (correct/judged)".padEnd(30)}${"wrong-write".padEnd(14)}scored`);
  const summary: Record<string, { coverage: string; precision: string; wrong_write_rate: string; scored: number; judged?: number; correct?: number }> = {};
  for (const field of FIELDS) {
    const s = board[field];
    const row = { coverage: pct(s.correct, s.scored), precision: pct(s.correct, s.produced), wrong_write_rate: pct(s.produced - s.correct, s.produced), scored: s.scored };
    console.log(`${field.padEnd(16)}${row.coverage.padEnd(12)}${`${row.precision} (${s.correct}/${s.produced})`.padEnd(30)}${row.wrong_write_rate.padEnd(14)}${s.scored}${s.unjudged ? `  (${s.unjudged} unjudged)` : ""}`);
    summary[field] = { ...row, judged: s.produced, correct: s.correct };
  }
  console.log(`rounds written without a date: ${roundDates.undated} of ${roundDates.rounds} (${pct(roundDates.undated, roundDates.rounds)})`);
  console.log(`founders written with a bio: ${founderBios.with_bio} of ${founderBios.founders} (${pct(founderBios.with_bio, founderBios.founders)})`);
  console.log("═".repeat(62));
  const checks = phase1Checks(board, { locationMismatches, duplicateRounds: duplicates, foundedAfterRound });
  console.log("Phase 1 rules (docs/enrichment_v2_spec.md §7):");
  for (const c of checks) console.log(`  ${c.pass ? "✅" : "❌"} ${c.rule} — ${c.detail}`);
  const wrongRows = companies.flatMap((c) => { const o = perCompany[c.id]?.output; return o ? wrongValues(c, o) : []; });
  console.log(`\nValues counted wrong: ${wrongRows.length}`);
  console.log(wrongValuesText(wrongRows));
  if (PIPELINE === "v2" && ran) {
    console.log(`\nHints (rounds only a data platform states — lib/enrichment/hints.ts):`);
    console.log(`  confirmed by a primary source and written: ${hintTotals.confirmed} — matching a golden round: ${hintTotals.confirmed_matching_golden}, matching none (wrong writes): ${hintTotals.confirmed - hintTotals.confirmed_matching_golden}`);
    console.log(`  kept as hints, not written: ${hintTotals.kept} — of which real golden rounds still to find: ${hintTotals.kept_matching_golden}`);
    console.log(`\n${RESCORE ? "Cost of the stored run" : "Cost"}: $${totalCost.toFixed(3)} total, $${(totalCost / ran).toFixed(4)} per company · time: ${(totalSeconds / ran).toFixed(0)} s per company`);
    if (!RESCORE) console.log(`Claude (${ENRICH_MODEL}${knownModel(ENRICH_MODEL) ? "" : " — no price on file, priced as Haiku 4.5"}): $${LLM.costUsd.toFixed(4)} total, $${(LLM.costUsd / ran).toFixed(4)} per company, from ${LLM.calls} calls' reported tokens (in ${LLM.inputTokens.toLocaleString()}, cache write ${LLM.cacheWriteTokens.toLocaleString()}, cache read ${LLM.cacheReadTokens.toLocaleString()}, out ${LLM.outputTokens.toLocaleString()})`);
    if (!RESCORE) console.log(`Longest prompt: ${LLM.maxPromptTokens.toLocaleString()} tokens · calls over ${LONG_PROMPT_TOKENS.toLocaleString()}: ${LLM.callsOverLong}${LLM.callsOverLong ? "  ⚠️  those are billed at Haiku 5.5's long-prompt rate ($0.50 / $2.50)" : " ✅"}`);
  }
  if (companies.length < 50 || unreviewed) {
    console.log(`\n⚠️  ${companies.length} companies${unreviewed ? `, ${unreviewed} not yet reviewed by a human` : ""} — Phase 1 is judged only on the full,`);
    console.log("   reviewed golden set (50+). Treat these numbers as a direction, not a verdict.\n");
  }

  const wrongFile = join(__dir, `wrong_values${COMPONENTS_LABEL ? `_${COMPONENTS_LABEL}` : ""}.csv`);
  writeFileSync(wrongFile, wrongValuesCsv(wrongRows));
  console.log(`\n📄  ${wrongRows.length} wrong value(s) with their sources: ${wrongFile}`);
  if (RESCORE) { console.log("RESCORE: nothing else written (the stored run and the review sheets are untouched)."); return; }
  // One file per component setting, so a baseline run and an all-on run sit side by side (eval/compare_runs.ts).
  const file = PIPELINE === "v1" ? "baseline.json" : `v2_results${COMPONENTS_LABEL ? `_${COMPONENTS_LABEL}` : ""}.json`;
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
  // Rounds v2 found that match no golden round (owner, 2026-10-29): the owner
  // marks whether each is real — a real one joins the golden set.
  const roundsToReview: SheetRow[] = [];
  for (const company of companies) {
    const verified = (company.funding_rounds ?? []).filter((r) => r.confidence !== "unknown");
    const unknown = [...(company.funding_rounds ?? []).filter((r) => r.confidence === "unknown"), ...(company.funding_rounds_excluded_unknown ?? []).map((r) => ({ ...r, confidence: "unknown" as const }))];
    const out = perCompany[company.id]?.output?.rounds ?? [];
    const matched = new Set(matchRounds(verified, out).map(([, i]) => i));
    out.forEach((r, i) => {
      if (matched.has(i) || unknown.some((u) => roundsDayGap(u, r) !== null) || isEvent(r.round_type)) return;
      // Only rounds from the company's site or the press of tiers 1–3 (owner, 2026-11-01).
      if (!reviewableSource(r.source_url, company.website)) return;
      roundsToReview.push({ company_id: company.id, company: company.name, round_type: r.round_type, amount_usd: r.amount_raised == null ? "" : String(r.amount_raised), date: r.date ?? "", lead_investor: r.lead_investor ?? "", source_url: r.source_url ?? "", mark: "" });
    });
  }
  // Domains on no list that rounds came from (roundSources.ts): allow / deny / ignore.
  const domainCounts = new Map<string, { seen: number; company: string; url: string }>();
  for (const company of companies) {
    for (const d of new Map((perCompany[company.id]?.output?.unlisted_domains ?? []).map((x) => [x.domain, x])).values()) {
      const e = domainCounts.get(d.domain);
      if (e) e.seen++; else domainCounts.set(d.domain, { seen: 1, company: company.name, url: d.url });
    }
  }
  if (domainCounts.size) {
    const sheet = join(__dir, "review", "domains_review.csv");
    mkdirSync(dirname(sheet), { recursive: true });
    const rows = [...domainCounts].sort((x, y) => y[1].seen - x[1].seen).map(([domain, e]) => ({ domain, companies: String(e.seen), example_company: e.company, example_url: e.url, decision: "" }));
    const existing = existsSync(sheet) ? parseCsv(readFileSync(sheet, "utf8")) : [];
    writeFileSync(sheet, toCsv(["domain", "companies", "example_company", "example_url", "decision"], mergeRows(existing, rows, (r) => r.domain)));
    console.log(`🌐  ${domainCounts.size} unlisted source domain(s) in eval/review/domains_review.csv — mark "מותר" / "אסור" / "להתעלם"`);
  }
  if (roundsToReview.length) {
    const sheet = join(__dir, "review", "rounds_review.csv");
    mkdirSync(dirname(sheet), { recursive: true });
    // Rows already marked stay; unmarked ones from a source no longer allowed go.
    const existing = (existsSync(sheet) ? parseCsv(readFileSync(sheet, "utf8")) : [])
      .filter((r) => r.mark?.trim() || reviewableSource(r.source_url, companies.find((c) => c.id === r.company_id)?.website));
    const merged = mergeRows(existing, roundsToReview, roundKey);
    writeFileSync(sheet, toCsv(ROUND_COLUMNS, merged));
    console.log(`📝  ${merged.length - existing.length} round(s) to mark in eval/review/rounds_review.csv ("נכון" / "לא נכון"), then: npx tsx eval/import_review.ts`);
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
    settings: PIPELINE === "v2" ? { model: ENRICH_MODEL, articles_to_read: ARTICLES_TO_READ, deep_dive: DEEP_DIVE, tech_gate: TECH_GATE, components: COMPONENTS, components_setting: process.env.V2_COMPONENTS ?? null } : undefined,
    fields: summary, phase1: checks, hints: PIPELINE === "v2" ? hintTotals : undefined, round_dates: roundDates,
    cost: PIPELINE === "v2" && ran ? { total_usd: totalCost, per_company_usd: totalCost / ran, seconds_per_company: totalSeconds / ran, claude_usd: LLM.costUsd, claude_per_company_usd: LLM.costUsd / ran } : undefined,
    llm: PIPELINE === "v2" ? { model: ENRICH_MODEL, priced: knownModel(ENRICH_MODEL), ...LLM.toJSON() } : undefined,
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
