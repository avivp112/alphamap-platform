/**
 * lib/enrichment/headcountHistory.ts — the rules of the headcount history (owner, 2026-11-07).
 * A point has a date, a value, a source and a TYPE:
 *   registry           a register's figure (Companies House average employees, Brreg, CVR) — official
 *   plan_participants  active participants of a Form 5500 plan — official, an approximation of employees
 *   site_stated        a team-size sentence on the company's own page, current or an archived copy — reported
 *   press_reported     a team-size sentence in an article or release, at its date — reported
 *   observed           a current figure read from an allowed source in the last two years
 *   model_estimate     never shown, never written as data
 * Rules: the current number and range come only from a point of the last two years; older points are for the chart
 * only; "75+" / "over 100" stay a lower bound; no interpolation (this module never creates a point); a jump, a
 * figure that does not fit the money raised, and two contradicting points in one month are reported.
 */
import { checkHeadcountOutlier } from "./validation.ts";

export type PointType = "registry" | "plan_participants" | "site_stated" | "press_reported" | "observed" | "model_estimate";
export const OFFICIAL_TYPES: PointType[] = ["registry", "plan_participants"];
export const POINT_TYPES: PointType[] = ["registry", "plan_participants", "site_stated", "press_reported", "observed", "model_estimate"];

export interface HistoryPoint {
  /** ISO date of the figure (period end, copy date, article date). */
  date: string;
  value: number;
  /** A range from a register ("20-49"): the upper end; value is the lower end. */
  valueMax?: number;
  /** "75+", "over 100": value is a floor, not the count. */
  lowerBound?: boolean;
  type: PointType;
  sourceUrl: string;
  quote?: string;
  /** What the figure measures: "average_in_period", "count_at_date", "participants", "range". */
  measure?: string;
}

const DAY = 86_400_000;
export const CURRENT_WINDOW_DAYS = 730;
const rank = (t: PointType) => (OFFICIAL_TYPES.includes(t) ? 0 : t === "observed" ? 1 : t === "site_stated" ? 2 : 3);

/** Whether a point may be shown or written as data. */
export const isData = (p: HistoryPoint) => p.type !== "model_estimate" && p.value > 0 && Number.isFinite(Date.parse(p.date));

/** The point the current number and range come from: the newest of the last two years, an official one first on a tie of month. */
export function currentPoint(points: HistoryPoint[], today: Date = new Date()): HistoryPoint | null {
  const recent = points.filter(isData).filter((p) => { const age = (today.getTime() - Date.parse(p.date)) / DAY; return age >= -31 && age <= CURRENT_WINDOW_DAYS; });
  recent.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || rank(a.type) - rank(b.type));
  return recent[0] ?? null;
}

export interface PointIssue { point: HistoryPoint; why: "jump" | "funding_mismatch" | "duplicate" }
export interface ScreenResult { kept: HistoryPoint[]; dropped: PointIssue[]; conflicts: Array<{ a: HistoryPoint; b: HistoryPoint }> }

const month = (d: string) => d.slice(0, 7);

/**
 * Screens a series. A point is dropped when it jumps ≥3× (up or down) from a point within 18 months before it
 * unless it is official and that one is not; when it does not fit the money raised (validation.ts); or when it
 * repeats a point of the same type in the same month. Two points of different types in one month that differ by
 * more than 25% are both kept and returned as a conflict — the page shows both, with their types.
 */
export function screenPoints(points: HistoryPoint[], ctx: { totalRaisedUsd?: number | null; foundedYear?: number | null } = {}): ScreenResult {
  const sorted = points.filter(isData).sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || rank(a.type) - rank(b.type));
  const kept: HistoryPoint[] = [];
  const dropped: PointIssue[] = [];
  for (const p of sorted) {
    if (kept.some((k) => k.type === p.type && month(k.date) === month(p.date))) { dropped.push({ point: p, why: "duplicate" }); continue; }
    if (checkHeadcountOutlier(p.lowerBound ? p.value : p.value, ctx.totalRaisedUsd ?? null, ctx.foundedYear ?? null)) { dropped.push({ point: p, why: "funding_mismatch" }); continue; }
    const before = [...kept].reverse().find((k) => (Date.parse(p.date) - Date.parse(k.date)) / DAY <= 548 && month(k.date) !== month(p.date));
    if (before) {
      const ratio = Math.max(p.value, before.value) / Math.min(p.value, before.value);
      const officialWins = OFFICIAL_TYPES.includes(p.type) && !OFFICIAL_TYPES.includes(before.type);
      if (ratio >= 3 && !officialWins) { dropped.push({ point: p, why: "jump" }); continue; }
    }
    kept.push(p);
  }
  const conflicts: ScreenResult["conflicts"] = [];
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
    const [a, b] = [kept[i], kept[j]];
    if (month(a.date) === month(b.date) && a.type !== b.type && Math.abs(a.value - b.value) / Math.max(a.value, b.value) > 0.25) conflicts.push({ a, b });
  }
  return { kept, dropped, conflicts };
}
