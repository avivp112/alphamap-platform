import { describe, it, expect } from "vitest";
import { newScoreboard, scoreCompany, duplicateRounds, foundedAfterFirstRound, phase1Checks, normalize, type GoldenCompany, type PipelineOutput } from "./score";

const v = <T,>(value: T) => ({ value, confidence: "verified" as const });
const apex: GoldenCompany = {
  id: "apex", name: "Apex", city: v("Los Angeles"), country: v("United States"), founded_year: v(2022),
  founders: [{ name: "Ian Cinnamon", confidence: "verified" }, { name: "Maximilian Benassi", confidence: "verified" }],
  funding_rounds: [
    { type: "Series D", amount_usd: 200_000_000, date: "2025-09", confidence: "verified" },
    { type: "Growth", amount_usd: 200_000_000, date: "2026-06", confidence: "verified" },
    { type: "Seed", amount_usd: null, date: "2022", confidence: "unknown" },
  ],
};
const out = (o: Partial<PipelineOutput> = {}): PipelineOutput => ({
  city: null, country: null, founded_year: null, founders: [], rounds: [], employee_range: null, arr_usd: null, ...o,
});

describe("scoreCompany", () => {
  it("counts right, wrong and missing separately; unknown golden values are excluded", () => {
    const b = newScoreboard();
    const r = scoreCompany(b, apex, out({ city: "Los Angeles", country: "USA", founded_year: 2021, founders: [{ name: "Ian Cinnamon" }] }));
    expect(r).toMatchObject({ city: "correct", country: "correct", founded_year: "wrong", founders: "wrong", funding_rounds: "missing", employee_range: "excluded" });
    expect(b.founded_year).toEqual({ scored: 1, produced: 1, correct: 0 });
    expect(b.founders).toEqual({ scored: 2, produced: 1, correct: 1 });
    expect(b.funding_rounds).toEqual({ scored: 2, produced: 0, correct: 0 });   // the unknown Seed is not scored
  });
  it("one extracted round never covers two golden rounds (the Apex duplicate-round bug)", () => {
    const b = newScoreboard();
    scoreCompany(b, apex, out({ rounds: [{ round_type: "Series D", amount_raised: 200_000_000, date: "2026-01-15" }] }));
    expect(b.funding_rounds.correct).toBe(1);
  });
  it("ARR within 20% counts as right", () => {
    const b = newScoreboard();
    scoreCompany(b, { ...apex, arr_usd: { value: 10_000_000, confidence: "verified" } }, out({ arr_usd: 11_500_000 }));
    expect(b.arr_usd).toEqual({ scored: 1, produced: 1, correct: 1 });
  });
});

describe("normalize", () => {
  it("the same place written two ways is the same place", () => {
    expect(normalize("U.S.")).toBe(normalize("United States"));
    expect(normalize("Tel Aviv-Yafo")).toBe(normalize("tel aviv"));
    expect(normalize("Zürich")).toBe("zurich");
    expect(normalize("Israel")).not.toBe(normalize("United States"));
  });
});

describe("Phase 1 rules", () => {
  it("finds a round written twice: same type, or same amount, within 9 months", () => {
    expect(duplicateRounds([
      { round_type: "Series D", amount_raised: 200_000_000, date: "2025-09-10" },
      { round_type: "Series D", amount_raised: null, date: "2025-11-01" },
      { round_type: "Growth", amount_raised: 205_000_000, date: "2026-02-01" },
    ])).toEqual([[0, 1], [0, 2]]);
    expect(duplicateRounds([
      { round_type: "Series D", amount_raised: 200_000_000, date: "2025-09-10" },
      { round_type: "Growth", amount_raised: 200_000_000, date: "2026-06-20" },   // 9+ months later: two real rounds
    ])).toEqual([]);
  });
  it("a founding year after the first round is impossible", () => {
    expect(foundedAfterFirstRound(out({ founded_year: 2023, rounds: [{ round_type: "Seed", amount_raised: 1, date: "2022-05-01" }] }))).toBe(true);
    expect(foundedAfterFirstRound(out({ founded_year: 2021, rounds: [{ round_type: "Seed", amount_raised: 1, date: "2022-05-01" }] }))).toBe(false);
  });
  it("pass/fail against the spec's thresholds", () => {
    const b = newScoreboard();
    b.city = { scored: 10, produced: 10, correct: 10 };
    b.country = { scored: 10, produced: 10, correct: 9 };
    b.funding_rounds = { scored: 20, produced: 10, correct: 9 };
    const c = phase1Checks(b, { locationMismatches: 1, duplicateRounds: 0, foundedAfterRound: 0 });
    expect(c.map((x) => x.pass)).toEqual([false, true, true, true, true]);
    expect(c[3].detail).toBe("95.0%");
  });
});
