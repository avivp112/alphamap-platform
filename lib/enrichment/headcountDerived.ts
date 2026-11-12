/**
 * The company's current headcount and size range, derived from its headcount history (owner, 2026-11-12). No separate source and no separate
 * marks: employee_count is the latest point of the history when it is from the last 24 months, and employee_range is the bracket of that
 * number ("75+" brackets by its lower bound). They open with employee_history (fieldReview.ts DERIVED_FROM_HISTORY).
 */
export const EMPLOYEE_RANGES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"] as const;
export const CURRENT_MAX_AGE_DAYS = 730;

export function rangeOfCount(n: number): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  if (n <= 5000) return "1001-5000";
  if (n <= 10000) return "5001-10000";
  return "10001+";
}

export interface DatedPoint { date: string; count: number; lowerBound?: boolean; countMax?: number }

/** The latest point, when it is at most 24 months old at `today`; null otherwise (an old figure is not today's headcount). */
export function currentFromHistory(points: DatedPoint[], today = new Date().toISOString().slice(0, 10)): { count: number; lowerBound: boolean; date: string; range: string } | null {
  const dated = points.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.count > 0 && Date.parse(p.date) <= Date.parse(today) + 86_400_000);
  if (!dated.length) return null;
  const last = dated.sort((a, b) => b.date.localeCompare(a.date))[0];
  if (Date.parse(today) - Date.parse(last.date) > CURRENT_MAX_AGE_DAYS * 86_400_000) return null;
  const range = rangeOfCount(last.count);
  return range ? { count: last.count, lowerBound: !!last.lowerBound, date: last.date, range } : null;
}
