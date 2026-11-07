/**
 * lib/enrichment/writeUnits.ts — what each review field writes (owner, 2026-11-05).
 *
 * The tracker (eval/field_review_tracker.csv) is the gate: a field is written only when it is
 * open there, in a pilot and in a wide run alike — PHASE1_PASSED does not lift it. A field with
 * no marks is never written. Pure; no file access.
 */

/** The review fields, and the startups columns each one writes. */
export const FIELD_COLUMNS: Record<string, string[]> = {
  hq_city: ["city"], hq_country: ["country"], founded_year: ["founded_year"], founding_country: ["founding_country"],
  office: ["offices", "office_countries"],
  // Added to the review before phase 1 (owner, 2026-11-07): the text, the sector and the sub-sector tags.
  description: ["description", "value_proposition"], sector: ["sector_id", "industry"], tags: [],
  employee_range: ["employee_range"], employee_count: ["employee_count"],
  // The dated points (headcount_history table), not a column of startups.
  employee_history: [],
  founder: ["founders"], leader: ["leadership"],
  // Two tiers of one column (owner, 2026-11-07): declared = a source says they compete; market = one market, per an allowed source.
  competitor_declared: ["competitors"], competitor_market: ["competitors"],
  patent: ["patents", "patent_count", "patent_fields"],
  news: ["news"],
  // Not columns of their own: the rounds table, and the bios inside founders / leadership.
  round: [], founder_bio: [], founder_background: [],
};

/** Every field a run may write once it is open. */
export const WRITABLE_FIELDS = Object.keys(FIELD_COLUMNS);

/** The columns of the open fields. */
export function openColumnsOf(open: readonly string[]): Set<string> {
  return new Set(open.flatMap((f) => FIELD_COLUMNS[f] ?? []));
}

export const writesRounds = (open: readonly string[]) => open.includes("round");
export const writesBios = (open: readonly string[]) => open.includes("founder_bio");
/** Whether a competitor of this tier may be written: its own field is open ("competitor", the field's name before the tiers, counts as declared). */
export const writesCompetitorTier = (open: readonly string[], tier: "declared" | "market" | undefined) =>
  tier === "market" ? open.includes("competitor_market") : open.includes("competitor_declared") || open.includes("competitor");
export const writesFounderBackground = (open: readonly string[]) => open.includes("founder_background");
export const writesTags = (open: readonly string[]) => open.includes("tags");
export const writesEmployeeHistory = (open: readonly string[]) => open.includes("employee_history");
export const writesHeadcount = (open: readonly string[]) => open.includes("employee_count");

/**
 * A patch cut to the open fields: the columns of fields that are not open are dropped (and named,
 * so the report can say what was held back).
 */
export function restrictPatch(patch: Record<string, unknown>, open: readonly string[]): { patch: Record<string, unknown>; heldBack: string[] } {
  const allowed = openColumnsOf(open);
  const kept: Record<string, unknown> = {};
  const heldBack: string[] = [];
  for (const [k, v] of Object.entries(patch)) (allowed.has(k) ? (kept[k] = v) : heldBack.push(k));
  return { patch: kept, heldBack };
}

/** The review field a column belongs to (for reports). */
export function fieldOfColumn(column: string): string | null {
  return Object.entries(FIELD_COLUMNS).find(([, cols]) => cols.includes(column))?.[0] ?? null;
}

/** A person without what only the bios field may write: the bio and the tags read off bios. */
export function withoutBio<T extends Record<string, unknown>>(person: T): T {
  const { bio: _b, bio_source_ids: _s, had_prior_exit: _e, elite_background: _g, notable_pedigree: _n, ...rest } = person as Record<string, unknown>;
  return rest as T;
}
