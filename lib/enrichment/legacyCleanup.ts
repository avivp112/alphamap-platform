/**
 * lib/enrichment/legacyCleanup.ts — what to do with patents, competitors and
 * rounds that runs before the 2026-10-26 fixes wrote, which kept no run_id
 * and so cannot be undone by run (owner's decision, 2026-10-27):
 *
 *   patents      every patent read off the web goes, with its count and
 *                fields; a patent from the EPO register (source "epo") stays.
 *   competitors  deleted only when its own explanation says it came from a
 *                "similar companies" / "alternatives" list, or describes a
 *                partner, customer, investor or host platform; any other
 *                competitor without a verified source is hidden (unverified),
 *                not deleted, until the next enrichment replaces it.
 *   rounds       (the 2026-10-26 run's) a round whose every source is a data
 *                platform is deleted; a type no source states becomes
 *                "Unknown" (debt the source calls debt becomes Debt); the
 *                amount stays when it has a source.
 *
 * Pure; scripts/clean_legacy_market_data.ts does the reads, the page fetches
 * and the writes. Tested with the run's own companies (legacyCleanup.test.ts).
 */

import { competitorRelation } from "./competitorRelation";
import { explanationIsListing } from "./competitorEvidence";
import { groundRoundType } from "./assemble";
import { classifySourceType, type LabeledSource } from "./sources";
import { extractNumbersFromText } from "./evidence";
import type { V2Round } from "./extractFunding";
import { normalizeRoundType } from "./rounds";

// ── Patents ──────────────────────────────────────────────────────────────────

export interface PatentRowState {
  patents: Array<{ title?: string; patent_number?: string | null; source?: string | null; [k: string]: unknown }> | null;
  patent_count: number | null;
  patent_fields: string[] | null;
}

export function planPatentCleanup(row: PatentRowState): { patch: Partial<PatentRowState>; removed: string[] } {
  const patents = row.patents ?? [];
  const fromRegister = patents.filter((p) => p?.source === "epo");
  const removed = patents.filter((p) => p?.source !== "epo").map((p) => p?.patent_number ?? p?.title ?? "(no number)");
  const patch: Partial<PatentRowState> = {};
  if (removed.length) patch.patents = fromRegister;
  // A count or fields not written together with register patents were read off pages.
  if (row.patent_count != null && (fromRegister.length === 0 || removed.length > 0)) patch.patent_count = null;
  if (row.patent_fields?.length) patch.patent_fields = [];
  return { patch, removed };
}

// ── Competitors ──────────────────────────────────────────────────────────────

export interface StoredCompetitor { name?: string; how_it_competes?: string | null; source_url?: string | null; unverified?: boolean; [k: string]: unknown }
export type CompetitorCleanup = "deleted_listing" | "deleted_relationship" | "hidden_unverified";

export function planCompetitorCleanup(list: Array<StoredCompetitor | string | null> | null, companyName: string): {
  competitors: Array<StoredCompetitor | string>; changes: Array<{ name: string; action: CompetitorCleanup; explanation: string }>;
} {
  const competitors: Array<StoredCompetitor | string> = [];
  const changes: Array<{ name: string; action: CompetitorCleanup; explanation: string }> = [];
  for (const raw of list ?? []) {
    if (!raw) continue;
    const c: StoredCompetitor = typeof raw === "string" ? { name: raw, how_it_competes: "" } : raw;
    const name = c.name ?? "";
    const explanation = c.how_it_competes ?? "";
    if (explanation && explanationIsListing(explanation)) { changes.push({ name, action: "deleted_listing", explanation }); continue; }
    if (explanation && name && competitorRelation(name, explanation, companyName)) { changes.push({ name, action: "deleted_relationship", explanation }); continue; }
    if (c.source_url || c.unverified) { competitors.push(raw); continue; }
    changes.push({ name, action: "hidden_unverified", explanation });
    competitors.push({ ...c, unverified: true });
  }
  return { competitors, changes };
}

// ── Rounds ───────────────────────────────────────────────────────────────────

export interface StoredRound {
  id: string; round_type: string | null; amount_raised: number | null; valuation?: number | null;
  announcement_date?: string | null; lead_investor?: string | null; source_url: string | null;
}
/** A field_provenance row for one of the round's fields ("funding_rounds.<id>.<column>"). */
export interface RoundEvidence { column: string; source_url: string | null; evidence_quote: string | null }
/** A fetched source page as text, or null when it could not be read. */
export interface Page { title: string; text: string }

export type RoundCleanup =
  | { action: "delete"; reason: "round_only_from_data_platform" }
  | { action: "update"; patch: { round_type?: string; amount_raised?: null }; notes: string[] }
  | { action: "keep" };

/** The sentence of a page that states this amount — what the round's quote would have been. */
function sentenceWithAmount(text: string, amount: number): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (sentence.length > 400) continue;
    if (extractNumbersFromText(sentence).some((n) => Math.abs(n - amount) / amount < 0.01)) return sentence.trim();
  }
  return null;
}

export function planRoundCleanup(round: StoredRound, evidence: RoundEvidence[], pages: Map<string, Page | null>): RoundCleanup {
  const urls = [...new Set([round.source_url, ...evidence.map((e) => e.source_url)].filter((u): u is string => !!u))];
  if (urls.length > 0 && urls.every((u) => classifySourceType(u) === "aggregator_snippet")) return { action: "delete", reason: "round_only_from_data_platform" };

  const notes: string[] = [];
  const patch: { round_type?: string; amount_raised?: null } = {};
  // The amount stays when something non-platform backs it: its provenance row, or the round's own source.
  const amountSource = evidence.find((e) => e.column === "amount_raised" && e.source_url && classifySourceType(e.source_url) !== "aggregator_snippet")?.source_url
    ?? (round.source_url && classifySourceType(round.source_url) !== "aggregator_snippet" ? round.source_url : null);
  if (round.amount_raised != null && !amountSource) { patch.amount_raised = null; notes.push("amount has no source"); }

  // The type, judged the way enrichment now judges it (assemble.ts groundRoundType):
  // the round's quotes, the passage around its amount, and the headline of a page that reports it.
  const sources: LabeledSource[] = urls.filter((u) => classifySourceType(u) !== "aggregator_snippet").map((url, i) => {
    const page = pages.get(url);
    return { source_id: `S${i + 1}`, url, title: page?.title ?? "", content: page?.text ?? "", provider: "serper", query_label: "legacy", source_type: classifySourceType(url) };
  });
  const idOf = (url: string | null) => sources.find((s) => s.url === url)?.source_id;
  const quoteFor = (column: string, value: unknown) => {
    const e = evidence.find((x) => x.column === column && x.evidence_quote);
    if (e && idOf(e.source_url)) return { value, source_id: idOf(e.source_url)!, evidence_quote: e.evidence_quote! };
    if (column !== "amount_raised" || typeof value !== "number") return undefined;
    for (const s of sources) {
      const sentence = s.content ? sentenceWithAmount(s.content, value) : null;
      if (sentence) return { value, source_id: s.source_id, evidence_quote: sentence };
    }
    return undefined;
  };
  const v2: V2Round = {
    round_type: round.round_type ?? "Unknown",
    amount_raised: round.amount_raised != null ? quoteFor("amount_raised", round.amount_raised) as V2Round["amount_raised"] : undefined,
    valuation: round.valuation != null ? quoteFor("valuation", round.valuation) as V2Round["valuation"] : undefined,
    announcement_date: round.announcement_date ? quoteFor("announcement_date", round.announcement_date) as V2Round["announcement_date"] : undefined,
    lead_investor: round.lead_investor ? quoteFor("lead_investor", round.lead_investor) as V2Round["lead_investor"] : undefined,
  };
  const typed = groundRoundType(v2, sources);
  // "Unknown" and "Other" are one label to the round-type normaliser.
  if (normalizeRoundType(typed.round_type) !== normalizeRoundType(round.round_type ?? "Unknown")) {
    patch.round_type = typed.round_type;
    const unread = sources.length > 0 && sources.every((s) => !s.content);
    notes.push(typed.round_type === "Unknown"
      ? `"${round.round_type}" is not stated in the source${unread ? " (its page could not be read)" : ""}`
      : `the source calls it ${typed.round_type}`);
  }
  return Object.keys(patch).length ? { action: "update", patch, notes } : { action: "keep" };
}
