import { describe, it, expect } from "vitest";
import { visiblePatents } from "./patentList";

describe("the patent list on a company page (owner, 2026-11-04 — Constructor's 114 families)", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ title: `P${i}`, filing_date: `20${10 + i}-01-01` }));
  it("more than 10: the 5 latest, until 'show all'", () => {
    const v = visiblePatents(many, false);
    expect(v).toMatchObject({ total: 14, collapsed: true });
    expect(v.shown.map((p) => p.title)).toEqual(["P13", "P12", "P11", "P10", "P9"]);
    expect(visiblePatents(many, true).shown).toHaveLength(14);
  });
  it("10 or fewer: all of them, latest first, undated last", () => {
    const v = visiblePatents([{ title: "A" }, { title: "B", filing_date: "2020-01-01" }, { title: "C", filing_date: "2024-01-01" }], false);
    expect(v.collapsed).toBe(false);
    expect(v.shown.map((p) => p.title)).toEqual(["C", "B", "A"]);
  });
});
