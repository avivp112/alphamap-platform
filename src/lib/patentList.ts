import type { PatentRecord } from "./supabase";

/** Above this many patents the list opens collapsed (owner, 2026-11-04). */
export const PATENTS_COLLAPSE_ABOVE = 10;
/** How many of the latest show while collapsed. */
export const PATENTS_SHOWN_COLLAPSED = 5;

/**
 * The patents to show, latest first (filing date; undated last). A company with more than
 * PATENTS_COLLAPSE_ABOVE shows its PATENTS_SHOWN_COLLAPSED latest until "show all".
 */
export function visiblePatents(patents: PatentRecord[], showAll: boolean): { shown: PatentRecord[]; total: number; collapsed: boolean } {
  const sorted = [...patents].sort((a, b) => (b.filing_date ?? "").localeCompare(a.filing_date ?? ""));
  const collapsible = sorted.length > PATENTS_COLLAPSE_ABOVE;
  const collapsed = collapsible && !showAll;
  return { shown: collapsed ? sorted.slice(0, PATENTS_SHOWN_COLLAPSED) : sorted, total: sorted.length, collapsed };
}
