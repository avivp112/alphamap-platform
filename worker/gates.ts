// =============================================================================
// worker/gates.ts — the threshold checks of "check a company", run before any
// enrichment money is spent. Same rules as enrichment v2:
//
//   1. PUBLIC company -> not allowed. Deterministic: a page that names the
//      company with an exchange ticker right after its legal name
//      ("Acme, Inc. (Nasdaq: ACME)") — lib/enrichment/listing.ts.
//   2. Too little public information -> "stealth". A legitimate outcome, not
//      an error: the company is watched privately for the user.
//   3. NOT a technology company -> not allowed, but only on a HIGH-confidence
//      verdict (lib/enrichment/techGate.ts) — an uncertain one goes through.
//
// decideGate() is pure (tested in gates.test.ts); runGates() gathers its
// evidence: the company's own pages (Jina) and two searches (Serper, through
// worker/search.ts so a rejected key fails the run instead of looking like an
// empty web). Searches and tokens go on the run's meter as they happen.
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createSearchProviderState, fetchCompanyWebsitePages } from "../lib/enrichment/searchProviders.ts";
import { findListingStatement, type ListingStatement } from "../lib/enrichment/listing.ts";
import { runTechGate, shouldSkipAsNonTech, type TechGateVerdict } from "../lib/enrichment/techGate.ts";
import { namesCompany } from "../lib/enrichment/headcount.ts";
import { websiteDomain } from "../lib/enrichment/websiteValidation.ts";
import type { Search } from "./search.ts";
import type { Meter } from "./runner.ts";
import { llmCostUsd } from "./config.ts";

export type GateStatus = "ready" | "stealth" | "rejected_public" | "rejected_non_tech";

export interface GateInput {
  name: string;
  website: string | null;
  country: string | null;
  sector: string | null;
}

export interface GateEvidence {
  listing: ListingStatement | null;
  /** Characters of text on the company's own pages. */
  ownPagesChars: number;
  /** Search results that name the company (or sit on its own domain). */
  mentions: number;
  tech: TechGateVerdict | null;
}

export interface GateDecision {
  status: GateStatus;
  /** Plain-language reason, shown to the user. */
  reason: string;
  evidence: GateEvidence;
}

/** Below both, there is not enough public material to say anything reliable. */
export const STEALTH_MAX_OWN_CHARS = 300;
export const STEALTH_MAX_MENTIONS = 1;

export function decideGate(e: GateEvidence): GateDecision {
  if (e.listing) {
    return { status: "rejected_public", reason: `Publicly listed — "${e.listing.quote}" (${e.listing.url}). AlphaMap covers private companies only.`, evidence: e };
  }
  if (e.ownPagesChars < STEALTH_MAX_OWN_CHARS && e.mentions <= STEALTH_MAX_MENTIONS) {
    return { status: "stealth", reason: "Very little public information yet — the company is probably in stealth. It is being watched for you.", evidence: e };
  }
  if (shouldSkipAsNonTech(e.tech)) {
    return { status: "rejected_non_tech", reason: `Not a technology company: ${e.tech!.reason}`, evidence: e };
  }
  return { status: "ready", reason: "Passed the checks.", evidence: e };
}

export interface GateRun {
  decision: GateDecision;
  pagesFetched: number;
}

export async function runGates(
  input: GateInput,
  deps: { anthropic: Anthropic; model: string; search: Search; meter: Meter },
): Promise<GateRun> {
  const state = createSearchProviderState();
  const domain = websiteDomain(input.website);

  const pages = input.website ? await fetchCompanyWebsitePages(input.website, state) : [];
  const anchor = domain ? ` "${domain}"` : input.country ? ` ${input.country}` : "";
  const [{ organic: general }, { organic: listing }] = await Promise.all([
    deps.search(`"${input.name}"${anchor}`, "check_identity"),
    deps.search(`"${input.name}" (Nasdaq OR NYSE OR "stock exchange" OR ticker)`, "check_listing"),
  ]);
  const results = [...general, ...listing];

  const sources = [
    ...pages.map((p) => ({ url: p.url, content: p.content })),
    ...results.map((r) => ({ url: r.url, title: r.title, content: r.content })),
  ];
  const ownPagesChars = pages.reduce((n, p) => n + p.content.trim().length, 0);
  const mentions = general.filter((r) =>
    (domain && websiteDomain(r.url) === domain) || namesCompany(`${r.title ?? ""} ${r.content}`, input.name)).length;
  const listingStatement = findListingStatement(input.name, sources, domain);

  // The tech verdict costs an LLM call: only when it can change the outcome.
  let tech: TechGateVerdict | null = null;
  const preliminary = decideGate({ listing: listingStatement, ownPagesChars, mentions, tech: null });
  if (preliminary.status === "ready") {
    const material = pages[0]?.content || general.slice(0, 5).map((r) => `${r.title ?? ""}: ${r.content}`).join("\n");
    const g = await runTechGate(input.name, material, null, input.sector, { client: deps.anthropic, model: deps.model });
    tech = g.verdict;
    deps.meter.llmInputTokens += g.inputTokens;
    deps.meter.llmOutputTokens += g.outputTokens;
    deps.meter.llmCostUsd += llmCostUsd(deps.model, g.inputTokens, g.outputTokens);
  }

  return {
    decision: decideGate({ listing: listingStatement, ownPagesChars, mentions, tech }),
    pagesFetched: state.websitePagesFetched,
  };
}
