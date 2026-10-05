import { describe, it, expect } from "vitest";
import {
  hasEarlyRoundGap, hasNoFinancingRounds, detectGaps, pickBacktrackInvestors, buildDeepDiveQueries, type GapInput,
} from "./deepDive";

const full: GapInput = {
  rounds: [{ round_type: "Seed" }, { round_type: "Series A", lead_investor: "a16z" }],
  bootstrapped: false, hasDescription: true, hasLocation: true, hasHeadcount: true, hasFounders: true,
  competitorCount: 4, newsCount: 3,
};

describe("funding gap detection", () => {
  it("flags a Series A+ with no earlier round (v1's early-round trigger)", () => {
    expect(hasEarlyRoundGap([{ round_type: "Series B" }])).toBe(true);
    expect(hasEarlyRoundGap([{ round_type: "Seed" }, { round_type: "Series B" }])).toBe(false);
  });
  it("treats an Acquired-only history as no financing history at all", () => {
    expect(hasNoFinancingRounds([{ round_type: "Acquired" }])).toBe(true);
    expect(hasNoFinancingRounds([{ round_type: "Seed" }])).toBe(false);
  });
});

describe("detectGaps", () => {
  it("returns nothing for a fully covered company", () => {
    expect(detectGaps(full)).toEqual([]);
  });
  it("flags every empty section", () => {
    expect(detectGaps({ ...full, rounds: [], hasHeadcount: false, competitorCount: 0, newsCount: 0 }))
      .toEqual(["funding", "profile", "competitors", "news"]);
  });
  it("adds the patent search and the founding-year search only when asked", () => {
    expect(detectGaps({ ...full, patentCount: 0 })).toEqual(["patents"]);
    expect(detectGaps({ ...full, hasFoundedYear: false })).toEqual(["profile"]);
    expect(buildDeepDiveQueries("patents", { name: "Gladia", anchor: "", domain: null, rounds: [], founderNames: [] })[0].query).toBe('site:patents.google.com "Gladia"');
  });
  it("never runs a funding deep dive on a company known to be bootstrapped", () => {
    expect(detectGaps({ ...full, rounds: [], bootstrapped: true })).not.toContain("funding");
  });
});

describe("pickBacktrackInvestors", () => {
  it("takes up to 2 distinct leads from the earliest later-stage rounds", () => {
    expect(pickBacktrackInvestors([
      { round_type: "Series C", lead_investor: "Tiger", announcement_date: "2022-01-01" },
      { round_type: "Series A", lead_investor: "a16z", announcement_date: "2019-01-01" },
      { round_type: "Series B", lead_investor: "a16z", announcement_date: "2020-01-01" },
      { round_type: "Seed", lead_investor: "YC", announcement_date: "2018-01-01" },
    ])).toEqual(["a16z", "Tiger"]);
  });
});

describe("buildDeepDiveQueries", () => {
  const ctx = { name: "Ghost", anchor: ' "ghost.org"', domain: "ghost.org", rounds: [{ round_type: "Series A", lead_investor: "a16z" }], founderNames: ["John O'Nolan"] };

  it("funding: seed/pre-seed searches, a News-endpoint 'raises' query, and investor backtracking — not the first-pass queries again", () => {
    const qs = buildDeepDiveQueries("funding", ctx);
    expect(qs.some((q) => q.query.includes("site:crunchbase.com"))).toBe(false);
    expect(qs.some((q) => q.kind === "news" && q.query === '"Ghost" raises')).toBe(true);
    expect(qs.some((q) => q.query.includes('"a16z" "Ghost"'))).toBe(true);
  });

  it("news: uses the News endpoint, including a founder-anchored query", () => {
    const qs = buildDeepDiveQueries("news", ctx);
    expect(qs.filter((q) => q.kind === "news").length).toBeGreaterThanOrEqual(3);
    expect(qs.some((q) => q.query.includes("John O'Nolan"))).toBe(true);
  });

  it("competitors: alternatives / vs / comparison-site queries", () => {
    const qs = buildDeepDiveQueries("competitors", ctx).map((q) => q.query);
    expect(qs).toContain('"Ghost" alternatives');
    expect(qs).toContain('"Ghost" vs');
    expect(qs.some((q) => q.includes("site:g2.com"))).toBe(true);
  });

  it("profile: LinkedIn and Crunchbase company pages (headcount + HQ), founders, team size", () => {
    const qs = buildDeepDiveQueries("profile", ctx).map((q) => q.query);
    expect(qs.some((q) => q.startsWith("site:linkedin.com/company"))).toBe(true);
    expect(qs.some((q) => q.startsWith("site:crunchbase.com/organization"))).toBe(true);
  });

  it("every query label is namespaced so deep-dive sources are distinguishable in evidence dumps", () => {
    for (const s of ["funding", "profile", "competitors", "news", "patents"] as const) {
      expect(buildDeepDiveQueries(s, ctx).every((q) => q.label.startsWith("deep_"))).toBe(true);
    }
  });
});
