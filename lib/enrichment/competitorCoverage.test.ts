import { describe, it, expect } from "vitest";
import { competitorCounts, coverageOf, coverageReport } from "./competitorCoverage";

describe("competitor coverage", () => {
  it("counts distinct names by tier; unverified on file is not counted; a name under both tiers counts once, as declared", () => {
    const c = competitorCounts({
      onFile: [{ name: "Rippling", tier: "declared" }, { name: "Gusto", unverified: true }, { name: "Deel" }],
      found: [{ name: "rippling", tier: "market" }, { name: "Workday", tier: "market" }, { name: "Deel", tier: "market" }],
    });
    expect(c).toEqual({ declared: 2, market: 1, all: 3 });
  });
  it("buckets 0, 1–2, 3+ and says whether half the companies reach 3+", () => {
    const mk = (n: number) => ({ onFile: [], found: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, tier: "declared" })) });
    const r = coverageOf([mk(0), mk(1), mk(2), mk(3), mk(5), mk(4)]);
    expect(r.all).toEqual({ companies: 6, zero: 1, oneTwo: 2, threePlus: 3 });
    expect(r.targetMet).toBe(true);
    expect(coverageOf([mk(0), mk(1), mk(3)]).targetMet).toBe(false);
    expect(coverageReport([mk(3)]).join("\n")).toMatch(/3\+: 1 \(100%\)/);
  });
});
