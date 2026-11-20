/**
 * lib/enrichment/tiers.ts — the two kinds of fields (owner, 2026-11-20: a working method that finishes the database without a wrong value reaching a customer).
 *   Core fields (Tier 1, Tier 2) are written to startups / field_provenance. They are in the regression gate, in the blocking acceptance checks and in the post-write audit.
 *   Candidate fields (Tier 3) are written only to candidate_values with full provenance, never to startups, never shown; they are in none of the three.
 * Required accuracy: Tier 1 98%, Tier 2 95%. A core field is shown in the pilot only after 150 random audited values above its tier's bar (field_status).
 * A field that is in no list (founding_country, board, patent) is not written at all.
 */
export const TIER1: readonly string[] = ["round", "acquired"];   // rounds (amount, type, date, lead), acquired / majority_acquired / closed. Public status and domain identification are decided before the fields.
export const TIER2: readonly string[] = ["description", "sector", "hq_city", "hq_country", "founded_year", "founder", "legal_name", "company_number", "incorporation_date", "incorporation_jurisdiction", "registered_address"];
export const TIER3: readonly string[] = ["tags", "news", "competitor_declared", "competitor_market", "employee_count", "employee_range", "headcount_history", "employee_history", "leader", "founder_background", "office", "name_proposal"];
export const CORE_FIELDS: readonly string[] = [...TIER1, ...TIER2];
export const REQUIRED_ACCURACY: Readonly<Record<1 | 2, number>> = { 1: 0.98, 2: 0.95 };
/** Random audited values a core field needs before the pilot shows it. */
export const PILOT_MIN_AUDITED = 150;
/** Errors in more than this many companies of the targeted sample undo the field for the run. */
export const TARGETED_MAX_ERROR_COMPANIES = 5;

/** A row field's family (description_what_only is the description; founder_bio belongs to the founder). */
export const familyOfField = (f: string): string => (f === "description_what_only" ? "description" : f === "founder_bio" ? "founder" : f);
export const tierOf = (field: string): 1 | 2 | 3 | null => {
  const f = familyOfField(field);
  return TIER1.includes(f) ? 1 : TIER2.includes(f) ? 2 : TIER3.includes(f) ? 3 : null;
};
export const isCoreField = (field: string): boolean => { const t = tierOf(field); return t === 1 || t === 2; };
export const isCandidateField = (field: string): boolean => tierOf(field) === 3;
