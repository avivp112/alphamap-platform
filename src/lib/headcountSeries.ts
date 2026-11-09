// =============================================================================
// src/lib/headcountSeries.ts — the headcount chart's points (owner, 2026-11-07).
// Points are shown by type: official (a register, a pension plan) and reported (the
// company's own page, an article, a current reading), each with its source on hover.
// A model estimate is never shown, and neither is a `legacy` point (a record whose source was not kept — owner,
// 2026-11-09: 9,487 points written by v1 with no source and no data date): hidden, not deleted, until a v2 run
// replaces them with sourced points. No line joins the points: a gap is a gap, not data.
// "Live data" appears only when a point is an `observed` one.
// =============================================================================

import type { HeadcountPoint, HeadcountPointType } from "./supabase";

export const TYPE_LABEL: Record<HeadcountPointType, string> = {
  registry: "Company register", plan_participants: "Pension plan participants (Form 5500)",
  site_stated: "Company site", press_reported: "Press", observed: "Observed", model_estimate: "Estimate", legacy: "Earlier record (source not kept)",
};
const OFFICIAL: HeadcountPointType[] = ["registry", "plan_participants"];

export interface ChartPoint {
  t: number; value: number; max: number | null; lowerBound: boolean;
  type: HeadcountPointType; label: string; source: string | null; quote: string | null; measure: string | null; date: string;
}

export function headcountSeries(points: HeadcountPoint[]): { official: ChartPoint[]; reported: ChartPoint[]; live: boolean } {
  const shaped: ChartPoint[] = points
    .map((p) => ({ ...p, type: (p.point_type ?? "legacy") as HeadcountPointType }))
    .filter((p) => p.type !== "model_estimate" && p.type !== "legacy" && p.employee_count > 0)
    .map((p) => ({
      t: Date.parse(p.recorded_date), value: p.employee_count, max: p.employee_count_max ?? null, lowerBound: !!p.is_lower_bound,
      type: p.type, label: TYPE_LABEL[p.type], source: p.source_url ?? null, quote: p.evidence_quote ?? null, measure: p.measure ?? null,
      date: new Date(p.recorded_date).toISOString().slice(0, 10),
    }))
    .sort((a, b) => a.t - b.t);
  return {
    official: shaped.filter((p) => OFFICIAL.includes(p.type)),
    reported: shaped.filter((p) => !OFFICIAL.includes(p.type)),
    live: shaped.some((p) => p.type === "observed"),
  };
}

/** "75+" for a floor, "20–49" for a range, the number otherwise. */
export function pointValueText(p: Pick<ChartPoint, "value" | "max" | "lowerBound">): string {
  return p.max ? `${p.value}–${p.max}` : p.lowerBound ? `${p.value}+` : String(p.value);
}
