import { describe, it, expect } from "vitest";
import { hasRealRounds, hasCompetitors, classifyTier } from "./queue";

describe("hasRealRounds", () => {
  it("true for any round that isn't the 'Other' catch-all", () => {
    expect(hasRealRounds([{ round_type: "Series A" }])).toBe(true);
    expect(hasRealRounds([{ round_type: "Bridge" }])).toBe(true); // real DB value, must count
  });
  it("false for an empty list or only 'Other' rounds", () => {
    expect(hasRealRounds([])).toBe(false);
    expect(hasRealRounds([{ round_type: "Other" }])).toBe(false);
    expect(hasRealRounds([{ round_type: null }])).toBe(false);
  });
});

describe("hasCompetitors", () => {
  it("true only for a non-empty array", () => {
    expect(hasCompetitors({ competitors: [{ name: "x" }] })).toBe(true);
    expect(hasCompetitors({ competitors: [] })).toBe(false);
    expect(hasCompetitors({ competitors: null })).toBe(false);
  });
});

describe("classifyTier", () => {
  it("Tier 1: no profile data and no real rounds", () => {
    const tier = classifyTier({ description: null, employee_count: null, competitors: null }, []);
    expect(tier).toBe(1);
  });
  it("Tier 3: full data -- description, headcount, a real round, and competitors", () => {
    const tier = classifyTier(
      { description: "A company.", employee_count: 50, competitors: [{ name: "x" }] },
      [{ round_type: "Series A" }],
    );
    expect(tier).toBe(3);
  });
  it("Tier 2: partial data (has description but no rounds yet)", () => {
    const tier = classifyTier({ description: "A company.", employee_count: null, competitors: null }, []);
    expect(tier).toBe(2);
  });
  it("Tier 2: has rounds and headcount but competitors still missing", () => {
    const tier = classifyTier(
      { description: "A company.", employee_count: 50, competitors: null },
      [{ round_type: "Series A" }],
    );
    expect(tier).toBe(2);
  });
});
