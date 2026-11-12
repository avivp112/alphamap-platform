import { describe, it, expect } from "vitest";
import { rangeOfCount, currentFromHistory } from "./headcountDerived";
import { fieldStatus, type Mark } from "./fieldReview";

describe("headcount derived from the history (owner, 2026-11-12)", () => {
  it("brackets", () => {
    expect([1, 10, 11, 50, 51, 75, 200, 201, 1000, 5001, 20000].map(rangeOfCount)).toEqual(["1-10", "1-10", "11-50", "11-50", "51-200", "51-200", "51-200", "201-500", "501-1000", "5001-10000", "10001+"]);
    expect(rangeOfCount(0)).toBeNull();
  });
  it("the current figure is the latest point when it is from the last 24 months; '75+' brackets by its lower bound", () => {
    const pts = [{ date: "2019-01-01", count: 20 }, { date: "2026-01-02", count: 75, lowerBound: true }];
    expect(currentFromHistory(pts, "2026-11-12")).toEqual({ count: 75, lowerBound: true, date: "2026-01-02", range: "51-200" });
  });
  it("an older latest point is not today's headcount", () => {
    expect(currentFromHistory([{ date: "2023-05-01", count: 40 }], "2026-11-12")).toBeNull();
    expect(currentFromHistory([], "2026-11-12")).toBeNull();
  });
  it("a point dated in the future is not used", () => {
    expect(currentFromHistory([{ date: "2030-01-01", count: 99 }], "2026-11-12")).toBeNull();
  });
});

describe("employee_count and employee_range open with employee_history, with no marks of their own", () => {
  const mk = (id: string, field: string, verdict: "correct" | "wrong"): Mark => ({ id, field, company: `C${id}`, value: "v", source_url: "u", verdict, source_of_mark: "" });
  it("mirror the history, whatever marks they carry themselves", () => {
    const marks = [...Array.from({ length: 20 }, (_, i) => mk(`h${i}`, "employee_history", "correct")), mk("c1", "employee_count", "wrong")];
    const st = fieldStatus(marks);
    for (const f of ["employee_history", "employee_count", "employee_range"]) expect(st.find((s) => s.field === f)).toMatchObject({ marked: 20, correct: 20, open: true });
  });
  it("closed together while the history is short of marks", () => {
    const st = fieldStatus(Array.from({ length: 19 }, (_, i) => mk(`h${i}`, "employee_history", "correct")));
    expect(st.filter((s) => s.open)).toHaveLength(0);
    expect(st.find((s) => s.field === "employee_range")?.marked).toBe(19);
  });
});
