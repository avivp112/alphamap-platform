// =============================================================================
// _shared/check-limits.ts — the one place the "check a company" limits live.
//
// Read by the company-check Edge Function (enforcement) and shown in the app.
// The plan comes from user_plans (migration 20261021000000), which users
// cannot write — never from auth user_metadata.
//
// PROVISIONAL VALUES. Per the product decision of 2026-10-21, the final
// numbers are set only after the average time and cost of one check have
// been measured (enrichment_runs where run_kind = 'on_demand'). Until then
// these are deliberately conservative.
// =============================================================================

export type Plan = "free" | "pro" | "enterprise";

export interface CheckLimits {
  /** Checks a user may start per calendar month (UTC). Matches of companies already in AlphaMap do not count. */
  checksPerMonth: number;
  /** Requests (including matches) per rolling hour — the rate limit. */
  requestsPerHour: number;
}

export const CHECK_LIMITS: Record<Plan, CheckLimits> = {
  free:       { checksPerMonth: 1,  requestsPerHour: 10 },
  pro:        { checksPerMonth: 20, requestsPerHour: 30 },
  enterprise: { checksPerMonth: 100, requestsPerHour: 60 },
};

/** A company already in AlphaMap enriched within this many days is shown as is, no new run. */
export const FRESH_ENOUGH_DAYS = 30;

/**
 * Statuses that do not use up the monthly allowance. Only check-phase rows
 * count at all: finding the company (the identify phase) is never charged,
 * the allowance is taken when the user confirms it. A company AlphaMap does
 * not cover (public, not technology) is not charged either (2026-10-18).
 */
export const FREE_OF_CHARGE_STATUSES = [
  "matched", "failed", "cancelled", "awaiting_confirmation", "rejected_public", "rejected_non_tech",
] as const;

// ── "Deepen this profile" (a company already in AlphaMap; 2026-10-20) ────────
// Completeness is the 0-15 score of startups_search (startup_completeness()).

/** A company scoring below this is deepened without using the monthly allowance (the rate limit still applies). */
export const DEEPEN_FREE_BELOW = 7;

/**
 * A company scoring below this may always be deepened. At or above it, one
 * enriched by v2 within FRESH_ENOUGH_DAYS is shown as is.
 */
export const DEEPEN_ALWAYS_BELOW = 7;

export function limitsFor(plan: string | null | undefined): CheckLimits {
  return CHECK_LIMITS[(plan === "pro" || plan === "enterprise") ? plan : "free"];
}
