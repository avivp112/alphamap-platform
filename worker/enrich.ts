// =============================================================================
// worker/enrich.ts — stage 3 of "check a company": runs enrichment v2's
// collection (lib/enrichment/collect.ts — the same engine as the bulk run)
// on the one company the user confirmed, then builds what they see.
//
// Differences from the bulk run, all deliberate:
//   * nothing is written to startups / funding_rounds: the result stays on
//     the user's own check (unverified until v2 passes Phase 1);
//   * no search cache: the bulk run's per-company disk cache would let one
//     user's check reuse another's (decision of 2026-10-21: no cross-user
//     cache);
//   * the tech pre-check is off — the threshold checks just ran it;
//   * one more full article read than the bulk default: a single company
//     can afford a deeper look.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createSearchProviderState, searchCalls } from "../lib/enrichment/searchProviders.ts";
import { collectCompany, newCollectStats, type CollectResult, type CollectStage, type V2StartupRow, type V2FundingRoundRow } from "../lib/enrichment/collect.ts";
import type { SectorTaxonomy } from "../lib/enrichment/extractProfile.ts";
import { cachedCallCostUsd } from "./config.ts";
import type { Meter } from "./runner.ts";

export const ARTICLES_TO_READ = 5;

export interface EnrichInput {
  checkId: string;
  name: string;
  website: string | null;
  country: string | null;
  founder: string | null;
}

/** A startups-shaped row for a company that has nothing on file yet. */
export function blankRow(i: EnrichInput): V2StartupRow {
  return {
    id: i.checkId, name: i.name, website: i.website,
    description: null, value_proposition: null, industry: null,
    founded_year: null, country: i.country, city: null, founding_country: null, israel_rnd_center: null, refresh_fields: [],
    employee_count: null, employee_range: null, growth_trend: null,
    // A founder the user named is an anchor for the entity filter and a
    // LinkedIn lookup; it is shown only if a source backs it.
    founders: i.founder ? [{ name: i.founder }] : null,
    leadership: null, competitors: null, acquisitions: null, news: null,
    patent_count: null, patent_fields: null, patents: null,
    tech_stack: null, github_url: null, huggingface_url: null,
    arr_milestones: null, revenue_estimate: null, valuation_benchmarks: null,
    linkedin_url: null, facebook_url: null, instagram_url: null,
    sector_id: null, funding_history_complete: null,
    status: "active", last_enriched_at: null, is_manually_verified: false,
  };
}

export interface EnrichDeps {
  anthropic: Anthropic;
  model: string;
  taxonomy: SectorTaxonomy;
  meter: Meter;
  onStage?: (stage: CollectStage, detail?: Record<string, unknown>) => void;
}

/** A company not in AlphaMap: collected from nothing on file. */
export function runEnrichment(input: EnrichInput, deps: EnrichDeps): Promise<CollectResult> {
  return runCollection(blankRow(input), [], deps);
}

/** Any company — for "deepen", the AlphaMap row and its rounds, exactly as the bulk run reads them. */
export async function runCollection(row: V2StartupRow, rounds: V2FundingRoundRow[], deps: EnrichDeps): Promise<CollectResult> {
  const searchState = createSearchProviderState();   // no .cache: see the header
  try {
    return await collectCompany(row, rounds, deps.taxonomy, {
      anthropic: deps.anthropic,
      models: { enrich: deps.model, profile: deps.model, funding: deps.model, market: deps.model },
      update: false, deepDive: true, techGate: false, articlesToRead: ARTICLES_TO_READ, verbose: false,
      seen: null,
      recordCost: (model, usage) => {
        deps.meter.llmInputTokens += usage.inputTokens + (usage.cacheWriteTokens ?? 0) + (usage.cacheReadTokens ?? 0);
        deps.meter.llmOutputTokens += usage.outputTokens;
        deps.meter.llmCostUsd += cachedCallCostUsd(model, usage);
      },
      onStage: deps.onStage,
    }, newCollectStats(), searchState);
  } finally {
    // Counted even when the run fails half way (the library counts calls that returned results).
    deps.meter.searchCalls += searchCalls(searchState);
  }
}
