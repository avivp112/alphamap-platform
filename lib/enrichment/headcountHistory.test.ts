import { describe, it, expect } from "vitest";
import { currentPoint, screenPoints, type HistoryPoint } from "./headcountHistory";

const p = (date: string, value: number, type: HistoryPoint["type"] = "press_reported", o: Partial<HistoryPoint> = {}): HistoryPoint => ({ date, value, type, sourceUrl: "https://s.example/" + date, ...o });
const today = new Date("2026-11-07");

describe("the current number comes only from the last two years (owner, 2026-11-07)", () => {
  it("an older point is for the chart only", () => {
    expect(currentPoint([p("2023-03-01", 80)], today)).toBeNull();
    expect(currentPoint([p("2023-03-01", 80), p("2025-06-01", 140)], today)?.value).toBe(140);
  });
  it("the newest wins; an official point wins a tie of month; a model estimate never counts", () => {
    expect(currentPoint([p("2025-06-10", 120, "press_reported"), p("2025-06-10", 130, "registry")], today)?.type).toBe("registry");
    expect(currentPoint([p("2026-09-01", 500, "model_estimate"), p("2025-01-01", 100)], today)?.value).toBe(100);
  });
  it("a lower bound stays a lower bound", () => {
    expect(currentPoint([p("2026-01-01", 75, "site_stated", { lowerBound: true })], today)).toMatchObject({ value: 75, lowerBound: true });
  });
});

describe("screening a series", () => {
  it("never creates a point (no interpolation)", () => {
    const r = screenPoints([p("2022-01-01", 10), p("2024-01-01", 30)]);
    expect(r.kept).toHaveLength(2);
  });
  it("a 3x jump within 18 months is dropped, unless it is official and the other is not", () => {
    expect(screenPoints([p("2024-01-15", 40), p("2024-09-15", 300)]).dropped.map((d) => d.why)).toEqual(["jump"]);
    expect(screenPoints([p("2024-01-15", 40), p("2024-09-15", 300, "registry")]).kept).toHaveLength(2);
    expect(screenPoints([p("2020-01-15", 40), p("2024-09-15", 300)]).kept).toHaveLength(2);
  });
  it("a figure that does not fit the money raised is dropped", () => {
    expect(screenPoints([p("2025-01-01", 5000)], { totalRaisedUsd: 8_000_000, foundedYear: 2022 }).dropped.map((d) => d.why)).toEqual(["funding_mismatch"]);
  });
  it("two points of different types in one month that disagree are both kept and reported", () => {
    const r = screenPoints([p("2025-03-05", 100, "press_reported"), p("2025-03-31", 160, "registry")]);
    expect(r.kept).toHaveLength(2);
    expect(r.conflicts).toHaveLength(1);
    expect([r.conflicts[0].a.type, r.conflicts[0].b.type].sort()).toEqual(["press_reported", "registry"]);
  });
  it("a second point of the same type in the same month is a duplicate", () => {
    expect(screenPoints([p("2025-03-05", 100), p("2025-03-20", 101)]).dropped.map((d) => d.why)).toEqual(["duplicate"]);
  });
});
