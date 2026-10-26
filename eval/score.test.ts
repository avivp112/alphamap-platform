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
  it("a real round the golden set could not source is neither right nor wrong", () => {
    const b = newScoreboard();
    const wiz: GoldenCompany = { id: "wiz", name: "Wiz",
      funding_rounds: [{ type: "Series E", amount_usd: 1_000_000_000, date: "2024-05", confidence: "verified" }],
      funding_rounds_excluded_unknown: [{ type: "Series D", amount_usd: 300_000_000, date: "2023-02" }] };
    scoreCompany(b, wiz, out({ rounds: [
      { round_type: "Series E", amount_raised: 1_000_000_000, date: "2024-05-07" },
      { round_type: "Series D", amount_raised: 300_000_000, date: "2023-02-20" },   // probably real: not counted
      { round_type: "Seed", amount_raised: 9_000_000, date: "2020-01-01" },         // not in the golden set at all: wrong
    ] }));
    expect(b.funding_rounds).toEqual({ scored: 1, produced: 2, correct: 1 });
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
    expect(c.map((x) => x.pass)).toEqual([false, true, true, true, true, false, false, false]);
    expect(c[3].detail).toBe("95.0%");
  });
  it("round type, competitors and patents each need enough judged values, then their own bar", () => {
    const b = newScoreboard();
    b.round_type = { scored: 30, produced: 25, correct: 24 };        // 96% of 25
    b.competitors = { scored: 40, produced: 12, correct: 12, unjudged: 9 };   // too few judged
    b.patents = { scored: 15, produced: 12, correct: 11 };            // 91.7% < 98%
    const c = phase1Checks(b, { locationMismatches: 0, duplicateRounds: 0, foundedAfterRound: 0 }).slice(5);
    expect(c.map((x) => x.pass)).toEqual([true, false, false]);
    expect(c[1].detail).toBe("only 12 judged, 9 unjudged — at least 20 needed (add to eval/golden_set.json)");
  });
});

describe("the fields the 2026-10-26 run got wrong", () => {
  it("round type: a stated Series A written as Growth is wrong; written as Unknown it is missing, not wrong", () => {
    const biotia: GoldenCompany = { id: "biotia", name: "Biotia", funding_rounds: [{ type: "Series A", amount_usd: 8_000_000, date: "2023-03", confidence: "verified" }] };
    const b = newScoreboard();
    expect(scoreCompany(b, biotia, out({ rounds: [{ round_type: "Growth", amount_raised: 8_000_000, date: "2023-03-14" }] })).round_type).toBe("wrong");
    expect(scoreCompany(b, biotia, out({ rounds: [{ round_type: "Unknown", amount_raised: 8_000_000, date: "2023-03-14" }] })).round_type).toBe("missing");
    expect(b.round_type).toEqual({ scored: 2, produced: 1, correct: 0 });
  });

  it("round type: BETA's $169M loan written as an equity series is wrong", () => {
    const beta: GoldenCompany = { id: "beta", name: "BETA Technologies", funding_rounds: [{ type: "Debt", amount_usd: 169_000_000, date: "2024-10", confidence: "verified" }] };
    const b = newScoreboard();
    expect(scoreCompany(b, beta, out({ rounds: [{ round_type: "Series C", amount_raised: 169_000_000, date: "2024-10-01" }] })).round_type).toBe("wrong");
    expect(scoreCompany(b, beta, out({ rounds: [{ round_type: "Debt", amount_raised: 169_000_000, date: "2024-10-01" }] })).round_type).toBe("correct");
  });

  it("competitors: Chalice's Cognitiv is right, LeadIQ's Powerlytics is wrong, an unlisted name is unjudged", () => {
    const chalice: GoldenCompany = { id: "chalice", name: "Chalice", competitors: { names: ["Cognitiv"], not_competitors: ["Powerlytics", "Algocraft", "Index Exchange"], confidence: "verified" } };
    const b = newScoreboard();
    expect(scoreCompany(b, chalice, out({ competitors: ["Cognitiv, Inc.", "Powerlytics", "The Trade Desk"] })).competitors).toBe("wrong");
    expect(b.competitors).toEqual({ scored: 1, produced: 2, correct: 1, unjudged: 1 });
  });

  it("patents: 1AHEAD's own patent is right, Snap's is wrong; with none on the register, any patent is wrong", () => {
    const ahead: GoldenCompany = { id: "1ahead", name: "1AHEAD Technologies", patents: { numbers: ["US 11,756,357 B2"], confidence: "verified" } };
    const b = newScoreboard();
    expect(scoreCompany(b, ahead, out({ patents: ["US11756357B2", "US10102680B2"] })).patents).toBe("wrong");
    expect(b.patents).toEqual({ scored: 1, produced: 2, correct: 1 });
    const none: GoldenCompany = { id: "as0001", name: "AS0001", patents: { numbers: [], none: true, confidence: "verified" } };
    expect(scoreCompany(newScoreboard(), none, out({ patents: ["US10169814B2"] })).patents).toBe("wrong");
    expect(scoreCompany(newScoreboard(), none, out({ patents: [] })).patents).toBe("correct");
  });

  it("a pipeline that does not produce competitors or patents is not scored on them", () => {
    const chalice: GoldenCompany = { id: "chalice", name: "Chalice", competitors: { names: ["Cognitiv"], confidence: "verified" } };
    expect(scoreCompany(newScoreboard(), chalice, out()).competitors).toBe("excluded");
  });
});

describe("founders — one person, two spellings", () => {
  it("Boguslavski and Boguslavsky are the same founder", () => {
    const b = newScoreboard();
    const port: GoldenCompany = { id: "port", name: "Port", founders: [{ name: "Yonatan Boguslavski", confidence: "verified" }, { name: "Zohar Einy", confidence: "verified" }] };
    scoreCompany(b, port, out({ founders: [{ name: "Yonatan Boguslavsky" }] }));
    expect(b.founders).toEqual({ scored: 2, produced: 1, correct: 1 });
  });
});
