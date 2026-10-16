// Pure helpers for the Deal Flow page (/deals), which reads the deal_feed
// view (migration 20261020000000): gated SEC Form D company rounds and
// venture fund raises. No Supabase import, so vitest runs these in Node —
// the data calls live in ./supabase.ts.

import { companyPath } from "./candidateReview";
import type { ExportColumn } from "./exportData";

export type DealKind = "company" | "fund";

export interface DealPerson {
  name?: string;
  relationships?: string[];
}

export interface DealFeedRow {
  id: string;
  kind: DealKind;
  name: string;
  startup_id: string | null;
  candidate_id: string | null;
  investor_id: string | null;
  firm_name: string | null;
  fund_series: number | null;
  deal_date: string;            // filing date of the offering (YYYY-MM-DD)
  updated_date: string | null;  // latest amendment folded into this row
  target_amount: number | null; // Form D totalOfferingAmount
  amount_raised: number | null; // Form D totalAmountSold
  deal_type: string;
  sector: string | null;
  industry_group: string | null;
  country: string | null;
  /** verified = the company / firm is in AlphaMap's database; unreviewed = found by the engine, not yet reviewed. */
  review_status: "verified" | "unreviewed";
  people: DealPerson[];
  source_url: string | null;
}

export interface DealFeedStats {
  count: number;
  total_raised: number;
  largest_name: string | null;
  largest_amount: number | null;
  top_key: string | null;
  top_count: number | null;
  month_count: number;
  month_raised: number;
  latest_date: string | null;
}

export type DealSort = "deal_date" | "amount_raised" | "target_amount";

/** "$12M", "$2.5M", "$950K", "—" for nothing. Form D amounts are whole dollars. */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${+(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Strips what would break or widen a PostgREST ilike/or filter (commas,
 * parentheses, wildcards, backslashes). A search box needs letters, digits,
 * spaces and the odd dash or dot.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()*%_\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Where a row leads inside the app: the company's tearsheet when it is in the
 * database, the candidate preview while it awaits review, nowhere otherwise.
 */
export function dealAppLink(row: Pick<DealFeedRow, "kind" | "startup_id" | "candidate_id">): string | null {
  if (row.kind !== "company") return null;
  if (row.startup_id) return companyPath(row.startup_id);
  if (row.candidate_id) return `/candidates/${encodeURIComponent(row.candidate_id)}`;
  return null;
}

/** Share of the offering sold so far, 0-100, or null when either side is unknown. */
export function soldPct(row: Pick<DealFeedRow, "amount_raised" | "target_amount">): number | null {
  const { amount_raised: sold, target_amount: target } = row;
  if (sold == null || target == null || target <= 0 || sold < 0) return null;
  return Math.min(100, Math.round((sold / target) * 100));
}

/** "Jane Doe (executive officer, director)", one per person, blanks dropped. */
export function personLabel(p: DealPerson): string | null {
  const name = p.name?.trim();
  if (!name) return null;
  const roles = (p.relationships ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean);
  return roles.length ? `${name} (${roles.join(", ")})` : name;
}

/** Columns of the CSV / JSON export — the facts the feed holds, nothing derived beyond them. */
export function exportColumns(kind: DealKind): ExportColumn<DealFeedRow>[] {
  const people = (r: DealFeedRow) => r.people.map(personLabel).filter(Boolean).join("; ");
  const common: ExportColumn<DealFeedRow>[] = [
    { label: "Filing date", value: (r) => r.deal_date },
    { label: "Last amended", value: (r) => (r.updated_date && r.updated_date !== r.deal_date ? r.updated_date : "") },
    { label: "Amount sold (USD)", value: (r) => r.amount_raised },
    { label: "Offering size (USD)", value: (r) => r.target_amount },
  ];
  if (kind === "fund") {
    return [
      { label: "Fund", value: (r) => r.name },
      { label: "Firm", value: (r) => r.firm_name },
      { label: "Fund number", value: (r) => r.fund_series },
      ...common,
      { label: "Firm in AlphaMap", value: (r) => (r.review_status === "verified" ? "yes" : "no") },
      { label: "Managers", value: people },
      { label: "SEC filing", value: (r) => r.source_url },
    ];
  }
  return [
    { label: "Company", value: (r) => r.name },
    { label: "Sector", value: (r) => r.sector },
    { label: "SEC industry", value: (r) => r.industry_group },
    { label: "Country", value: (r) => r.country },
    ...common,
    { label: "Reviewed by AlphaMap", value: (r) => (r.review_status === "verified" ? "yes" : "no") },
    { label: "Related people", value: people },
    { label: "SEC filing", value: (r) => r.source_url },
  ];
}
