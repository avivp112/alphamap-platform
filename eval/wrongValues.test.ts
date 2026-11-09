import { describe, it, expect } from "vitest";
import { wrongValues, wrongValuesText } from "./wrongValues";
import type { GoldenCompany, PipelineOutput } from "./score";

const v = <T,>(value: T) => ({ value, confidence: "verified" as const });
const g: GoldenCompany = {
  id: "z", name: "Zepto", city: v("Mumbai"), founded_year: v(2020), founding_country: v("India"),
  funding_rounds: [{ type: "Series A", amount_usd: 60_000_000, date: "2021-10", confidence: "verified" }],
};
const out = (o: Partial<PipelineOutput>): PipelineOutput => ({ city: null, country: null, founded_year: null, founders: [], rounds: [], employee_range: null, arr_usd: null, ...o });

describe("wrong values listing", () => {
  it("lists a wrong scalar with the golden value and where v2 found it", () => {
    const rows = wrongValues(g, out({ founded_year: 2021, scalar_sources: { founded_year: { source_url: "https://x.test/a", quote: "launched in 2021" } } }));
    expect(rows).toEqual([{ company: "Zepto", field: "founded_year", v2: "2021", golden: "2020", source_url: "https://x.test/a", quote: "launched in 2021" }]);
  });
  it("says so when an older run did not store the source", () => {
    const rows = wrongValues(g, out({ city: "Bengaluru" }));
    expect(rows[0].quote).toContain("not stored");
  });
  it("lists a produced round that matches no golden round, with the golden rounds beside it", () => {
    const rows = wrongValues(g, out({ rounds: [{ round_type: "Series A", amount_raised: 60_000_000, date: "2021-10" }, { round_type: "Seed", amount_raised: 5_000_000, date: "2022", source_url: "https://x.test/r" }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "funding_round", source_url: "https://x.test/r" });
    expect(rows[0].v2).toContain("Seed");
    expect(rows[0].golden).toContain("Series A");
  });
  it("lists nothing for a correct or missing value", () => {
    expect(wrongValues(g, out({ founded_year: 2020 }))).toEqual([]);
    expect(wrongValuesText([])).toBe("No value was counted wrong.");
  });
});

describe("wrong patents are listed too (owner, 2026-11-07)", () => {
  const wayve: GoldenCompany = { id: "wayve", name: "Wayve", patents: { numbers: ["US2023000001A1"], not_numbers: ["US2015348141A1"], confidence: "verified" } as never };
  it("lists a number the owner did not mark as the company's, with its Espacenet link", () => {
    const rows = wrongValues(wayve, out({ patents: ["US2023000001A1", "US2015348141A1", "US2015149302A1"] }));
    expect(rows.map((r) => [r.field, r.v2])).toEqual([["patent", "US2015348141A1"], ["patent", "US2015149302A1"]]);
    expect(rows[0].golden).toContain("marked not the company's");
    expect(rows[0].source_url).toContain("espacenet.com");
  });
  it("lists nothing when every number is the company's", () => {
    expect(wrongValues(wayve, out({ patents: ["US2023000001A1"] }))).toEqual([]);
  });
});
