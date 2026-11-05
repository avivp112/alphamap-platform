import { describe, it, expect } from "vitest";
import { capPerCompany } from "./fieldReview";

describe("the marking sample (owner, 2026-11-04)", () => {
  it("at most 2 values of one company in a field", () => {
    const xs = [..."aaaaab"].map((c, i) => ({ company_id: c, i }));
    expect(capPerCompany(xs, 2).map((x) => x.company_id)).toEqual(["a", "a", "b"]);
  });
});

import { sameReviewValue, countedMarks, type Mark } from "./fieldReview";
describe("the marks counted against the current rules (owner, 2026-11-04)", () => {
  it("a re-derived value is the marked one", () => {
    expect(sameReviewValue("leader", "Gil Hirsch — Board & Advisor; Founder & CMO, StreamElements", "Gil Hirsch — Board member")).toBe(true);
    expect(sameReviewValue("round", "Other $4M · 2024-03-21", "Other $4.0M · 2022-04-05")).toBe(true);
    expect(sameReviewValue("round", "Debt amount not disclosed · 2024-09-19", "Debt $450.0M · 2024-09-19")).toBe(false);
    expect(sameReviewValue("hq_city", "London", "London")).toBe(true);
    expect(sameReviewValue("office", "Tel Aviv, Israel", "Tel Aviv, Israel")).toBe(true);
    expect(sameReviewValue("patent", "EP4381061A1 SYSTEMS FOR MODULATING", "EP4381061A1 Systems for modulating drug metabolism")).toBe(true);
    expect(sameReviewValue("news", "2025-01-06 — Masttro Appoints Jay McNamara as Chief Executive Officer", "Masttro Appoints Jay McNamara as Chief Executive Officer")).toBe(true);
    expect(sameReviewValue("founded_year", "2019", "2013")).toBe(false);
  });
  it("a mark the current rules no longer produce leaves the count; the rest stay, right or wrong", () => {
    const m = (id: string, verdict: Mark["verdict"]): Mark => ({ id, field: "leader", company: "X", value: "A — CEO", source_url: "", verdict, source_of_mark: "" });
    const marks = [m("1", "correct"), m("2", "wrong"), m("3", "wrong"), m("4", "correct")];
    const counted = countedMarks(marks, new Map([["2", false], ["3", true], ["4", true]]));
    expect(counted.map((x) => x.id)).toEqual(["1", "3", "4"]);
  });
});
