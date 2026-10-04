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
 * Usage:
 *   npx tsx eval/run_eval.ts                 # score only, no DB writes at all
 *   STORE_EVIDENCE=true npx tsx eval/run_eval.ts   # also write enrichment_runs/enrichment_evidence
 *
 * Needs the same env vars as bulk_enrich_all.ts (SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, SERP_KEY, TAVILY_API_KEY,
 * JINA_API_KEY) — loaded via the same initV1Context() v1 itself uses.
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  initV1Context, loadSectorTaxonomy, researchCompany, supabase,
  type EnrichmentResult,
} from "../scripts/bulk_enrich_all.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const STORE_EVIDENCE = process.env.STORE_EVIDENCE === "true";

// ── Golden set types ──────────────────────────────────────────────────────
type Confidence = "verified" | "likely" | "unknown";
interface GoldenField<T> { value: T | null; confidence: Confidence; source_url?: string; notes?: string }
interface GoldenFounder { name: string; title?: string; confidence: Confidence; source_url?: string }
interface GoldenRound {
  type: string; amount_usd: number | null; date: string | null;
  lead_investor?: string | null; valuation_usd?: number | null; confidence: Confidence;
}
interface GoldenCompany {
  id: string; name: string; website?: string;
  city?: GoldenField<string>; country?: GoldenField<string>; founded_year?: GoldenField<number>;
  founders?: GoldenFounder[]; funding_rounds?: GoldenRound[];
  employee_range?: GoldenField<string>; github_url?: string | null; huggingface_url?: string | null;
}
interface GoldenSet { version: number; companies: GoldenCompany[] }

// ── Scoring accumulators ─────────────────────────────────────────────────
interface FieldStats { scored: number; produced: number; correct: number }
function newStats(): FieldStats { return { scored: 0, produced: 0, correct: 0 }; }
function pct(n: number, d: number): string { return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`; }

const stats: Record<string, FieldStats> = {
  city: newStats(), country: newStats(), founded_year: newStats(),
  founders: newStats(), funding_rounds: newStats(), employee_range: newStats(),
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function scoreScalar(field: keyof typeof stats, golden: GoldenField<string | number> | undefined, extracted: unknown) {
  if (!golden || golden.confidence === "unknown" || golden.value == null) return; // excluded, not guessed
  const s = stats[field];
  s.scored++;
  if (extracted == null || extracted === "") return; // v1 produced nothing — reduces coverage, doesn't count toward precision/wrong-write-rate at all
  s.produced++;
  if (normalize(String(extracted)) === normalize(String(golden.value))) s.correct++;
}

// Coverage denominator = golden founder count (did v1 find each real
// founder); precision denominator = extracted founder count (of everyone v1
// NAMED as a founder, how many are real) — these are genuinely different
// counts for a list field, unlike a scalar field where both denominators
// coincide. `correct` is shared since a name matching both sides is simply
// correct either way.
function scoreFounders(golden: GoldenFounder[] | undefined, extracted: EnrichmentResult["profile"]["founders"]) {
  const verifiedGolden = (golden ?? []).filter((f) => f.confidence !== "unknown");
  if (verifiedGolden.length === 0) return;
  const s = stats.founders;
  const goldenNames = new Set(verifiedGolden.map((f) => normalize(f.name)));
  const extractedList = extracted ?? [];
  s.scored += verifiedGolden.length;
  s.produced += extractedList.length;
  s.correct += extractedList.filter((f) => goldenNames.has(normalize(f.name))).length;
}

// Round match window mirrors v1's own insertNewRounds() dedup logic (±6mo),
// widened slightly to ±9mo for amount-only matches per the v2 spec's own
// round-dedup proposal (issue 5) — this eval isn't running v2's dedup code,
// just approximating "is this clearly the same real-world event".
//
// Returns the day-gap (not just true/false) so scoreRounds() below can pick
// the CLOSEST unused extracted round when several satisfy the ±10%/±9mo
// window — e.g. Apex's two real $200M rounds (Series D Sept-2025, Growth
// Jun-2026) are BOTH within 9 months of a hypothetical "$200M Apr-2026"
// entry; a single extracted round must not be allowed to satisfy both golden
// rounds at once, or this harness would miss the exact duplicate-round bug
// it exists to catch. Returns null when no match.
function roundsDayGap(g: GoldenRound, e: { amount_raised?: number | null; date?: string | null }): number | null {
  if (g.amount_usd == null || e.amount_raised == null) return null;
  const amountClose = Math.abs(e.amount_raised - g.amount_usd) / g.amount_usd <= 0.1;
  if (!amountClose) return null;
  if (!g.date || !e.date) return 0; // amount match with no date on one side — can't disprove it, treat as a (weak) match
  const gDate = new Date(g.date.length === 4 ? `${g.date}-06-15` : g.date.length === 7 ? `${g.date}-15` : g.date);
  const eDate = new Date(e.date);
  const diffDays = Math.abs(gDate.getTime() - eDate.getTime()) / 86_400_000;
  return diffDays <= 270 ? diffDays : null; // ~9 months
}

function scoreRounds(golden: GoldenRound[] | undefined, extracted: EnrichmentResult["funding_rounds"]) {
  const verifiedGolden = (golden ?? []).filter((r) => r.confidence !== "unknown");
  if (verifiedGolden.length === 0) return;
  const s = stats.funding_rounds;
  const extractedNorm = (extracted ?? []).map((r) => ({ round_type: r.round_type, amount_raised: r.amount_raised ?? null, date: r.date ?? null }));
  s.scored += verifiedGolden.length;
  s.produced += extractedNorm.length; // every extracted round counts toward "produced" — a hallucinated/duplicate round shows up as produced-but-not-correct, exactly the APEX bug this is meant to catch

  // Greedy injective matching, closest-date-first: each extracted round can
  // satisfy AT MOST ONE golden round. Without this, one extracted round
  // sitting between two real golden rounds (both within the tolerance
  // window) would incorrectly "cover" both — silently hiding a missing
  // round behind a coincidentally-nearby one, exactly the failure mode that
  // let the real Apex duplicate-round bug go unnoticed in the first place.
  const usedExtractedIdx = new Set<number>();
  // Sort golden rounds so the ones with the single closest available match
  // get first pick, not just array order — otherwise an earlier golden
  // round could grab an extracted round that a later golden round needed
  // more (no other candidate at all).
  const withBestGap = verifiedGolden.map((gr) => {
    let bestIdx = -1, bestGap = Infinity;
    extractedNorm.forEach((er, idx) => {
      if (usedExtractedIdx.has(idx)) return;
      const gap = roundsDayGap(gr, er);
      if (gap !== null && gap < bestGap) { bestGap = gap; bestIdx = idx; }
    });
    return { gr, bestIdx, bestGap };
  }).sort((a, b) => a.bestGap - b.bestGap);

  for (const { gr, bestIdx } of withBestGap) {
    if (bestIdx < 0 || usedExtractedIdx.has(bestIdx)) continue; // already claimed by a closer golden round
    // Re-verify this extracted round is still gr's best AVAILABLE match
    // (another golden round scored earlier in this sorted pass might have
    // taken it) — if so, fall through to find the next-best unused one.
    let idx = bestIdx, gap = Infinity;
    extractedNorm.forEach((er, i) => {
      if (usedExtractedIdx.has(i)) return;
      const g = roundsDayGap(gr, er);
      if (g !== null && g < gap) { gap = g; idx = i; }
    });
    if (gap === Infinity) continue; // no unused candidate left for this golden round
    usedExtractedIdx.add(idx);
    s.correct++;
  }
}

// ── Evidence storage (best-effort, see header comment on Phase 0 limits) ──
async function findExistingStartupId(name: string): Promise<string | null> {
  const { data, error } = await supabase.from("startups").select("id").ilike("name", name).limit(1).maybeSingle();
  if (error) { console.warn(`    ⚠️  startups lookup failed for "${name}": ${error.message}`); return null; }
  return (data as { id: string } | null)?.id ?? null;
}

async function main() {
  await initV1Context();
  await loadSectorTaxonomy();

  const golden: GoldenSet = JSON.parse(readFileSync(join(__dir, "golden_set.json"), "utf8"));
  console.log(`Loaded ${golden.companies.length} golden-set companies.\n`);

  let runId: string | null = null;
  if (STORE_EVIDENCE) {
    const { data, error } = await supabase.from("enrichment_runs").insert({
      pipeline: "v1",
      dry_run: true,
      profile_model: process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001",
      funding_model: process.env.ENRICH_MODEL ?? "claude-haiku-4-5-20251001",
      thresholds: { MIN_CONFIDENCE: Number(process.env.MIN_CONFIDENCE ?? 40) },
      companies_count: golden.companies.length,
    }).select("run_id").single();
    if (error) console.warn(`⚠️  Could not create enrichment_runs row: ${error.message} — continuing without evidence storage.`);
    else runId = (data as { run_id: string }).run_id;
  }

  const results: Record<string, EnrichmentResult | null> = {};

  for (const company of golden.companies) {
    console.log(`── ${company.name} (${company.id}) ──`);

    // researchCompany() performs NO database writes — verified by code
    // review (see its own doc comment in bulk_enrich_all.ts) and enforced
    // here at runtime: wrap the shared `supabase` client's mutating methods
    // to throw for the duration of this one call, so a regression in v1
    // (or a future edit that doesn't realize eval depends on this) fails
    // loudly instead of silently writing to production data from an eval run.
    const guardedMethods = ["insert", "update", "upsert", "delete"] as const;
    const originalFrom = supabase.from.bind(supabase);
    (supabase as unknown as { from: typeof supabase.from }).from = ((table: string) => {
      const qb = originalFrom(table);
      for (const m of guardedMethods) {
        const orig = (qb as unknown as Record<string, unknown>)[m];
        if (typeof orig === "function") {
          (qb as unknown as Record<string, unknown>)[m] = () => {
            throw new Error(`researchCompany() must never write to the database — blocked .${m}() on "${table}" during eval.`);
          };
        }
      }
      return qb;
    }) as typeof supabase.from;

    let result: EnrichmentResult | null = null;
    try {
      result = await researchCompany(company.name, company.website ?? null, company.country?.value ?? null);
    } catch (err) {
      console.error(`    ❌  researchCompany threw: ${String(err)}`);
    } finally {
      (supabase as unknown as { from: typeof supabase.from }).from = originalFrom;
    }
    results[company.id] = result;

    if (!result) {
      console.log("    (no result — all searches failed or write-guard tripped)\n");
      continue;
    }

    scoreScalar("city", company.city, result.profile.city);
    scoreScalar("country", company.country, result.profile.country);
    scoreScalar("founded_year", company.founded_year, result.profile.founded_year);
    scoreFounders(company.founders, result.profile.founders);
    scoreRounds(company.funding_rounds, result.funding_rounds);
    scoreScalar("employee_range", company.employee_range, result.metrics.employee_range);

    console.log(`    city="${result.profile.city ?? "—"}" country="${result.profile.country ?? "—"}" founded_year=${result.profile.founded_year ?? "—"}`);
    console.log(`    founders=${(result.profile.founders ?? []).map((f) => f.name).join(", ") || "—"}`);
    console.log(`    rounds=${result.funding_rounds.length} (golden: ${(company.funding_rounds ?? []).filter((r) => r.confidence !== "unknown").length} verified)`);

    if (STORE_EVIDENCE && runId) {
      const startupId = await findExistingStartupId(company.name);
      if (startupId) {
        const { error } = await supabase.from("enrichment_evidence").insert({
          run_id: runId,
          startup_id: startupId,
          source_id: "v1-aggregate-context",
          query_label: "v1_full_research_pass",
          provider: "serper", // best single label for v1's primary engine; the real mix (Serper/Tavily/Jina) isn't separately exposed by researchCompany()'s return value — see header comment
          content: JSON.stringify(result).slice(0, 50_000),
          kept: true,
        });
        if (error) console.warn(`    ⚠️  enrichment_evidence insert failed: ${error.message}`);
      } else {
        console.log(`    ℹ️   No existing startups row matched "${company.name}" — skipping evidence storage (extraction was still scored above).`);
      }
    }
    console.log("");
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log("═".repeat(62));
  console.log("PHASE 0 BASELINE — v1 (bulk_enrich_all.ts) vs eval/golden_set.json");
  console.log("═".repeat(62));
  // coverage = recall: of the golden TRUE values, how many did v1 correctly
  // surface (correct/scored) — NOT "did v1 attempt this field", which would
  // conflate attempting with succeeding and overstate coverage whenever v1
  // confidently produces a WRONG value for every company.
  // precision = of what v1 actually output, how much was right (correct/produced).
  // wrong-write-rate = of what v1 actually output, how much was wrong
  // (produced-correct)/produced — this one IS about attempts, deliberately,
  // since a wrong write only exists where something was written at all.
  console.log(`${"field".padEnd(16)}${"coverage".padEnd(12)}${"precision".padEnd(12)}${"wrong-write".padEnd(14)}scored`);
  const summary: Record<string, { coverage: string; precision: string; wrong_write_rate: string; scored: number }> = {};
  for (const [field, s] of Object.entries(stats)) {
    const coverage = pct(s.correct, s.scored);
    const precision = pct(s.correct, s.produced);
    const wrongWrite = pct(s.produced - s.correct, s.produced);
    console.log(`${field.padEnd(16)}${coverage.padEnd(12)}${precision.padEnd(12)}${wrongWrite.padEnd(14)}${s.scored}`);
    summary[field] = { coverage, precision, wrong_write_rate: wrongWrite, scored: s.scored };
  }
  console.log("═".repeat(62));
  console.log(`\n⚠️  Baseline computed on ${golden.companies.length} golden-set companies — far too few for the`);
  console.log(`   precision numbers above to be meaningful on their own. Re-run as the golden set grows`);
  console.log(`   past the Phase 0 target (50 companies) before treating these percentages as real.\n`);

  writeFileSync(
    join(__dir, "baseline.json"),
    JSON.stringify({
      pipeline: "v1", generated_at: new Date().toISOString(), companies_scored: golden.companies.length,
      fields: summary,
      // Raw per-company extraction, kept alongside the aggregate numbers so a
      // human can see WHY a field scored the way it did (e.g. confirm Apex's
      // funding_rounds coverage gap is the real duplicate-round bug and not
      // an eval bug) without re-running the whole pipeline.
      raw_results: results,
    }, null, 2),
  );
  console.log(`Wrote eval/baseline.json (pipeline: v1, ${golden.companies.length} companies).`);
}

main().catch((e) => {
  console.error("💥  Fatal error:", e);
  process.exit(1);
});
