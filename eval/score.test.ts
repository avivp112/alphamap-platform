import { describe, it, expect } from "vitest";
import { newScoreboard, scoreCompany, duplicateRounds, foundedAfterFirstRound, phase1Checks, normalize, hintGain, type GoldenCompany, type PipelineOutput } from "./score";

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
    expect(r).toMatchObject({ city: "correct", country: "correct", founded_year: "wrong", founders: "missing", funding_rounds: "missing", employee_range: "excluded" });
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
    expect(c[3].detail).toBe("95.0% (19/20 judged)");
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
    expect(b.competitors).toEqual({ scored: 0, produced: 2, correct: 1, unjudged: 1 });   // precision only: no coverage
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

describe("what the hints added (owner, 2026-10-28)", () => {
  it("counts a confirmed hint matching a golden round as a round gained, and a kept one as still to find", () => {
    const darkowl: GoldenCompany = { id: "darkowl", name: "DarkOwl", funding_rounds: [{ type: "Growth", amount_usd: 8_000_000, date: "2024-05", confidence: "verified" }] };
    expect(hintGain(darkowl, {
      confirmed: [{ round_type: "Growth", amount_raised: 8_000_000, date: "2024-05-14", source_url: "https://www.prnewswire.com/x" }],
      kept: [{ round_type: "Seed", amount_raised: 160_000, date: null, source_url: "https://getlatka.com/companies/apify" }],
    })).toEqual({ confirmed: 1, confirmed_matching_golden: 1, kept: 1, kept_matching_golden: 0 });
  });
});

describe("a duplicate is one round written twice, not two real rounds (eval run of 2026-10-29)", () => {
  it("Apex's three $200M rounds, each matching its own golden round, are not duplicates", () => {
    const apexGolden: GoldenCompany = { id: "apex", name: "Apex", funding_rounds: [
      { type: "Series C", amount_usd: 200_000_000, date: "2025-04", confidence: "verified" },
      { type: "Series D", amount_usd: 200_000_000, date: "2025-09", confidence: "verified" },
      { type: "Growth", amount_usd: 200_000_000, date: "2026-06-05", confidence: "verified" },
    ] };
    const rounds = [
      { round_type: "Series E", amount_raised: 200_000_000, date: "2026-06-05" },
      { round_type: "Series D", amount_raised: 200_000_000, date: "2025-09-12" },
      { round_type: "Series C", amount_raised: 200_000_000, date: "2025-04-28" },
    ];
    expect(duplicateRounds(rounds)).toHaveLength(2);
    expect(duplicateRounds(rounds, apexGolden)).toEqual([]);
    expect(duplicateRounds([...rounds, { round_type: "Series D", amount_raised: 200_000_000, date: "2025-10-01" }], apexGolden)).not.toEqual([]);
  });
});


describe("a year-only round is scored as that year (Wayve's 2019 Series A, eval of 2026-10-29)", () => {
  it("'2019' matches a round of November 2019; '2019-01-01' as a day would not", async () => {
    const { roundsDayGap } = await import("./score");
    const golden = { type: "Series A", amount_usd: 20_000_000, date: "2019-11", confidence: "high" } as Parameters<typeof roundsDayGap>[0];
    expect(roundsDayGap(golden, { amount_raised: 20_000_000, date: "2019" })).not.toBeNull();
    expect(roundsDayGap(golden, { amount_raised: 20_000_000, date: "2019-01-01" })).toBeNull();
  });
});

describe("a run whose provider ran out of credit stops (run of 2026-11-01: 25 of 32 companies lost)", () => {
  it("Anthropic's credit error and a rejected key are fatal; a network blip is not", async () => {
    const { isFatalProviderError } = await import("./score");
    expect(isFatalProviderError(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'))).toBe(true);
    expect(isFatalProviderError(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'))).toBe(true);
    expect(isFatalProviderError(new TypeError("fetch failed"))).toBe(false);
  });
});

describe("an event the golden set does not list is not a wrong round (Wiz's $32B acquisition, eval of 2026-11-01)", () => {
  it("an unmatched acquisition is left out of 'produced'", async () => {
    const { scoreCompany, newScoreboard } = await import("./score");
    const board = newScoreboard();
    const company = { id: "wiz", name: "Wiz", funding_rounds: [{ type: "Series C", amount_usd: 250_000_000, date: "2021-10", confidence: "verified" as const }] };
    scoreCompany(board, company, { city: null, country: null, founded_year: null, founders: [], employee_range: null,
      rounds: [{ round_type: "Series C", amount_raised: 250_000_000, date: "2021-10" }, { round_type: "Acquired", amount_raised: 32_000_000_000, date: "2025-03-18" }] });
    expect([board.funding_rounds.correct, board.funding_rounds.produced]).toEqual([1, 1]);
  });
});

describe("a headquarters the company does not declare (Port, Aidoc, SSI — owner, 2026-11-01)", () => {
  it("empty is correct, a city is wrong", async () => {
    const { scoreCompany, newScoreboard } = await import("./score");
    const company = { id: "aidoc", name: "Aidoc", city: { value: null, confidence: "verified" as const, not_declared: true }, country: { value: null, confidence: "verified" as const, not_declared: true } };
    const blank = { country: null, founded_year: null, founders: [], rounds: [], employee_range: null };
    const a = newScoreboard();
    expect(scoreCompany(a, company, { ...blank, city: null }).city).toBe("correct");
    const b = newScoreboard();
    expect(scoreCompany(b, company, { ...blank, city: "New York City", country: "United States" }).city).toBe("wrong");
  });
});

describe("reviewed_fields — a golden value counts only when its field was reviewed (owner, 2026-11-05)", () => {
  const wrongOut = out({ city: "Paris", country: "France", founded_year: 1999, founders: [{ name: "Nobody Known" }] as never, rounds: [] });
  it("without reviewed_fields every field is scored", () => {
    const b = newScoreboard();
    scoreCompany(b, apex, wrongOut);
    expect(b.city.scored).toBe(1);
    expect(b.founded_year.scored).toBe(1);
  });
  it("a field not listed is excluded: nothing scored, no matter what the pipeline produced", () => {
    const b = newScoreboard();
    const r = scoreCompany(b, { ...apex, reviewed_fields: ["rounds"] }, wrongOut);
    expect(r.city).toBe("excluded");
    expect(r.country).toBe("excluded");
    expect(r.founded_year).toBe("excluded");
    expect(r.founders).toBe("excluded");
    expect(b.city.scored).toBe(0);
    expect(b.founders.scored).toBe(0);
  });
  it("a listed field is still scored", () => {
    const b = newScoreboard();
    const r = scoreCompany(b, { ...apex, reviewed_fields: ["city"] }, wrongOut);
    expect(r.city).toBe("wrong");
    expect(b.city.scored).toBe(1);
    expect(b.country.scored).toBe(0);
  });
});

describe("two headquarters, unlisted founders, spellings (owner, 2026-11-05)", () => {
  const celonis: GoldenCompany = { id: "celonis", name: "Celonis", city: { value: "New York", alternatives: ["Munich"], confidence: "verified" } };
  it("any accepted value of a company with two headquarters is correct", () => {
    for (const c of ["New York", "Munich"]) {
      const b = newScoreboard();
      expect(scoreCompany(b, celonis, out({ city: c })).city).toBe("correct");
    }
    expect(scoreCompany(newScoreboard(), celonis, out({ city: "Berlin" })).city).toBe("wrong");
  });
  const hailo: GoldenCompany = { id: "hailo", name: "Hailo", founders: [{ name: "Orr Danon", confidence: "verified" }, { name: "Avi Baum", confidence: "verified" }] };
  it("a founder the pipeline finds who is not in the golden set is unjudged, not wrong", () => {
    const b = newScoreboard();
    const r = scoreCompany(b, hailo, out({ founders: [{ name: "Orr Danon" }, { name: "Avi Baum" }, { name: "Rami Feig" }] }));
    expect(r.founders).toBe("correct");
    expect(b.founders).toMatchObject({ scored: 2, produced: 2, correct: 2, unjudged: 1 });
  });
  it("a golden founder not found lowers coverage; with founders_complete an unlisted person is wrong", () => {
    const b = newScoreboard();
    expect(scoreCompany(b, hailo, out({ founders: [{ name: "Orr Danon" }] })).founders).toBe("missing");
    expect(b.founders).toMatchObject({ scored: 2, produced: 1, correct: 1 });
    const b2 = newScoreboard();
    const r = scoreCompany(b2, { ...hailo, founders_complete: true }, out({ founders: [{ name: "Orr Danon" }, { name: "Avi Baum" }, { name: "Rami Feig" }] }));
    expect(r.founders).toBe("wrong");
    expect(b2.founders).toMatchObject({ produced: 3, correct: 2 });
  });
  it("another spelling listed as aka is the same person", () => {
    const upwind: GoldenCompany = { id: "u", name: "Upwind", founders: [{ name: "Tal Zuri", aka: ["Tal Tzur"], confidence: "verified" }] };
    const b = newScoreboard();
    expect(scoreCompany(b, upwind, out({ founders: [{ name: "Tal Tzur" }] })).founders).toBe("correct");
  });
});

describe("a round without an amount on the type and date of a golden round is unjudged (owner, 2026-11-06)", () => {
  const mercury: GoldenCompany = { id: "m", name: "Mercury", funding_rounds: [
    { type: "Series C", amount_usd: 300_000_000, date: "2025-03-26", confidence: "verified" },
    { type: "Series D", amount_usd: 200_000_000, date: "2026-05-20", confidence: "verified" },
  ] };
  it("Mercury's 'Series D, no amount, 2026-05-20' is not a wrong write", () => {
    const b = newScoreboard();
    scoreCompany(b, mercury, out({ rounds: [{ round_type: "Series C", amount_raised: 300_000_000, date: "2025-03-26" }, { round_type: "Series D", amount_raised: null, date: "2026-05-20" }] }));
    expect(b.funding_rounds).toMatchObject({ scored: 2, produced: 1, correct: 1, unjudged: 1 });
  });
  it("another type, another date, or a round on no golden round stays wrong", () => {
    for (const r of [{ round_type: "Series E", amount_raised: null, date: "2026-05-20" }, { round_type: "Series D", amount_raised: null, date: "2026-09-01" }]) {
      const b = newScoreboard();
      scoreCompany(b, mercury, out({ rounds: [r] }));
      expect(b.funding_rounds.produced).toBe(1);
      expect(b.funding_rounds.correct).toBe(0);
    }
  });
});
