// =============================================================================
// src/lib/capital.ts — Total Raised counts equity only; debt is shown apart
// (owner, 2026-10-26: BETA's $169M Export-Import Bank loan showed as "total
// raised $169.0M"). The same rule as lib/enrichment/rounds.ts capitalKind()
// and the funding_rounds.capital_type column (migration 20261107000000).
// =============================================================================

export type CapitalKind = "equity" | "debt" | "not_capital";

const DEBT = new Set(["Debt", "Venture Debt"]);
const NOT_CAPITAL = new Set(["Secondary", "IPO", "Acquired", "PE Buyout"]);

export function capitalKind(roundType: string | null | undefined): CapitalKind {
  if (roundType && DEBT.has(roundType)) return "debt";
  return roundType && NOT_CAPITAL.has(roundType) ? "not_capital" : "equity";
}

interface RoundAmount { round_type: string | null; amount_raised: number | null }

/** Equity raised: every round but debt and events that bring no new money (a secondary, an acquisition). */
export function equityRaised(rounds: RoundAmount[]): number {
  return rounds.reduce((sum, r) => (capitalKind(r.round_type) === "equity" ? sum + (r.amount_raised ?? 0) : sum), 0);
}

/** Debt taken on: loans, credit facilities, venture debt. */
export function debtRaised(rounds: RoundAmount[]): number {
  return rounds.reduce((sum, r) => (capitalKind(r.round_type) === "debt" ? sum + (r.amount_raised ?? 0) : sum), 0);
}
