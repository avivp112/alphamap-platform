import { describe, it, expect } from "vitest";
import { headcountSeries, pointValueText } from "./headcountSeries";

const pt = (d: string, n: number, type?: string, o = {}) => ({ recorded_date: `${d}T00:00:00Z`, employee_count: n, point_type: type as never, ...o });
describe("the headcount chart's points", () => {
  it("official and reported apart; a model estimate never shown", () => {
    const s = headcountSeries([pt("2023-12-31", 90, "registry"), pt("2024-05-01", 120, "press_reported"), pt("2025-01-01", 500, "model_estimate"), pt("2024-12-31", 110, "plan_participants")]);
    expect(s.official.map((p) => p.value)).toEqual([90, 110]);
    expect(s.reported.map((p) => p.value)).toEqual([120]);
  });
  it("'Live data' only when a point is observed", () => {
    expect(headcountSeries([pt("2024-01-01", 10, "press_reported"), pt("2025-01-01", 12, "site_stated")]).live).toBe(false);
    expect(headcountSeries([pt("2025-01-01", 12, "observed")]).live).toBe(true);
  });
  it("a point from before the migration (no type, or legacy) is shown as reported with its own label, never live", () => {
    const s = headcountSeries([pt("2024-01-01", 10), pt("2024-06-01", 12, "legacy")]);
    expect(s.reported).toHaveLength(2);
    expect(s.reported.every((p) => p.type === "legacy")).toBe(true);
    expect(s.live).toBe(false);
  });
  it("floors and ranges keep their form", () => {
    expect(pointValueText({ value: 75, max: null, lowerBound: true })).toBe("75+");
    expect(pointValueText({ value: 20, max: 49, lowerBound: false })).toBe("20–49");
    expect(pointValueText({ value: 5, max: null, lowerBound: false })).toBe("5");
  });
});
