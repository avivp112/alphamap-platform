/**
 * lib/enrichment/deepDive.ts — Stage 9: a targeted second search pass for
 * whatever a company's first pass left empty. v1 has had two of these all
 * along (deepDiveEarlyRounds, deepDiveProfile); v2 deferred them, which is
 * a large part of why it came back thinner than v1 on real runs.
 *
 * v2's version covers more sections (funding, profile/headcount,
 * competitors, news) and differs from v1's in one important way: the
 * deep-dive results go through the SAME evidence-gated extraction as the
 * first pass (extractFunding / extractProfile / extractMarket), not a
 * free-text schema with no source requirements. v1's deep-dive schemas
 * have no evidence fields at all, which is exactly where its reasoning-vs-
 * written-value mismatches come from.
 *
 * This module is pure: it decides which sections need a second pass and
 * builds the queries. The orchestrator runs the searches and the
 * extraction calls.
 */

import { normalizeRoundType, type RoundLike } from "./rounds";

export type DeepDiveSection = "funding" | "profile" | "competitors" | "news";

export interface DeepDiveQuery {
  label: string;
  query: string;
  /** "news" uses Serper's News endpoint; "web" the regular web search. */
  kind: "web" | "news";
}

const EARLY_STAGE = new Set(["Pre-Seed", "Seed", "Convertible Note"]);
const LATER_STAGE = new Set(["Series A", "Series B", "Series C", "Series D", "Series E", "Series F+", "Growth"]);
// Outcome events that, on their own, don't describe how a company was
// financed — a company with only an "Acquired" row still has no funding
// history worth the name.
const NON_FINANCING = new Set(["Acquired", "IPO", "Other", "Unknown"]);

/** A confirmed Series A+ with no Pre-Seed/Seed/Convertible Note — companies almost never skip straight to an institutional round. */
export function hasEarlyRoundGap(rounds: RoundLike[]): boolean {
  const types = new Set(rounds.map((r) => normalizeRoundType(r.round_type)));
  return [...types].some((t) => LATER_STAGE.has(t)) && ![...types].some((t) => EARLY_STAGE.has(t));
}

export function hasNoFinancingRounds(rounds: RoundLike[]): boolean {
  return !rounds.some((r) => !NON_FINANCING.has(normalizeRoundType(r.round_type)));
}

export interface GapInput {
  /** Existing DB rounds plus first-pass rounds, combined. */
  rounds: RoundLike[];
  /** Known bootstrapped/self-funded — no funding deep dive. */
  bootstrapped: boolean;
  hasDescription: boolean;
  hasLocation: boolean;
  hasHeadcount: boolean;
  hasFounders: boolean;
  competitorCount: number;
  newsCount: number;
}

export function detectGaps(g: GapInput): DeepDiveSection[] {
  const gaps: DeepDiveSection[] = [];
  if (!g.bootstrapped && (hasNoFinancingRounds(g.rounds) || hasEarlyRoundGap(g.rounds))) gaps.push("funding");
  if (!g.hasDescription || !g.hasLocation || !g.hasHeadcount || !g.hasFounders) gaps.push("profile");
  if (g.competitorCount === 0) gaps.push("competitors");
  if (g.newsCount === 0) gaps.push("news");
  return gaps;
}

/** Up to 2 distinct lead investors from the earliest confirmed later-stage rounds — seed and Series A backers frequently overlap. */
export function pickBacktrackInvestors(rounds: RoundLike[]): string[] {
  return [...new Set(
    rounds
      .filter((r) => LATER_STAGE.has(normalizeRoundType(r.round_type)))
      .sort((a, b) => (a.announcement_date ?? "9999").localeCompare(b.announcement_date ?? "9999"))
      .map((r) => r.lead_investor?.trim())
      .filter((v): v is string => !!v),
  )].slice(0, 2);
}

export interface QueryContext {
  name: string;
  /** e.g. ` "ghost.org"` or ` United Kingdom (startup OR tech company)` or "". */
  anchor: string;
  domain: string | null;
  rounds: RoundLike[];
  /** Founder names known after the first pass — used to anchor news queries for non-distinctive names. */
  founderNames: string[];
}

export function buildDeepDiveQueries(section: DeepDiveSection, ctx: QueryContext): DeepDiveQuery[] {
  const { name, anchor, domain } = ctx;
  const q = (label: string, query: string, kind: "web" | "news" = "web"): DeepDiveQuery => ({ label: `deep_${label}`, query, kind });

  switch (section) {
    case "funding": {
      const investors = pickBacktrackInvestors(ctx.rounds);
      return [
        q("funding_raises", `"${name}"${anchor} raises funding round million investors`),
        q("funding_databases", `"${name}" funding rounds investors site:crunchbase.com OR site:tracxn.com OR site:dealroom.co OR site:pitchbook.com OR site:cbinsights.com`),
        q("funding_seed", `"${name}"${anchor} seed round raised announcement`),
        q("funding_preseed", `"${name}"${anchor} pre-seed OR angel round raised`),
        q("funding_news", `"${name}" raises`, "news"),
        ...investors.map((inv, i) => q(`funding_investor_${i}`, `"${inv}" "${name}" investment seed OR "Series A" portfolio`)),
      ];
    }
    case "profile":
      return [
        q("profile_linkedin", `site:linkedin.com/company "${name}"${domain ? ` ${domain}` : ""}`),
        q("profile_crunchbase", `site:crunchbase.com/organization "${name}"`),
        q("profile_founders", `"${name}"${anchor} founder CEO "co-founded" OR "founded by"`),
        q("profile_headcount", `"${name}"${anchor} employees team size headquarters`),
      ];
    case "competitors":
      return [
        q("competitors_alternatives", `"${name}" alternatives`),
        q("competitors_vs", `"${name}" vs`),
        q("competitors_lists", `"${name}" competitors similar companies site:g2.com OR site:capterra.com OR site:crunchbase.com OR site:cbinsights.com OR site:tracxn.com OR site:owler.com`),
        ...(domain ? [q("competitors_domain", `"${domain}" competitors OR alternatives`)] : []),
      ];
    case "news":
      return [
        q("news_plain", `"${name}"`, "news"),
        q("news_announces", `"${name}" announces OR launches OR partners OR acquires`, "news"),
        ...ctx.founderNames.slice(0, 1).map((f) => q("news_founder", `"${name}" "${f}"`, "news")),
        q("news_web", `"${name}"${anchor} press release announcement`),
      ];
  }
}
