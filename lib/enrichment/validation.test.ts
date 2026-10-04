import { describe, it, expect } from "vitest";
import {
  cityExistsInCountry, checkCityCountryMismatch, checkFoundedYear,
  checkHeadcountOutlier, checkRoundValuation, checkRoundDate, checkStageOrder,
  checkProfileCountryConflict, validateEnrichment,
} from "./validation";
import type { RoundLike } from "./rounds";

describe("cityExistsInCountry", () => {
  it("confirms a real city/country pair", () => {
    expect(cityExistsInCountry("London", "United Kingdom")).toBe(true);
    expect(cityExistsInCountry("Tel Aviv", "Israel")).toBe(true);
  });
  it("catches the literal production bug: Los Angeles is not in the United Kingdom", () => {
    expect(cityExistsInCountry("Los Angeles", "United Kingdom")).toBe(false);
  });
  it("gives the benefit of the doubt when the country name can't be resolved", () => {
    expect(cityExistsInCountry("Somewhere", "Neverland")).toBe(true);
  });
  it("gives the benefit of the doubt when the city isn't in the dataset at all", () => {
    expect(cityExistsInCountry("Zzzznotarealplacezzz", "United States")).toBe(true);
  });
});

describe("checkCityCountryMismatch", () => {
  it("flags the APEX CREATIONS LTD bug shape and asks for external resolution, not a guess", () => {
    const issue = checkCityCountryMismatch("Los Angeles", "United Kingdom");
    expect(issue?.rule).toBe("city_country_mismatch");
    expect(issue?.action).toBe("drop_both");
    expect(issue?.needsExternalResolution).toBe(true);
  });
  it("passes a real pair through silently", () => {
    expect(checkCityCountryMismatch("London", "United Kingdom")).toBeNull();
  });
});

describe("checkFoundedYear", () => {
  it("flags founded_year after the earliest funding round (issue: APEX founded 2026, funded since 2022)", () => {
    const issue = checkFoundedYear(2026, 2022);
    expect(issue?.rule).toBe("founded_after_first_round");
    expect(issue?.action).toBe("drop_field");
  });
  it("flags an out-of-range year", () => {
    expect(checkFoundedYear(1850, null)?.rule).toBe("founded_out_of_range");
    expect(checkFoundedYear(new Date().getFullYear() + 5, null)?.rule).toBe("founded_out_of_range");
  });
  it("passes a consistent founding year", () => {
    expect(checkFoundedYear(2022, 2022)).toBeNull();
    expect(checkFoundedYear(2020, 2022)).toBeNull();
  });
});

describe("checkHeadcountOutlier", () => {
  it("flags the Fresha-shape bug: headcount wildly outsized relative to capital raised", () => {
    // Fresha's real total raised is ~$206M; 140,000 employees is the actual
    // production bug value.
    const issue = checkHeadcountOutlier(140_000, 206_000_000);
    expect(issue?.rule).toBe("headcount_outlier");
    expect(issue?.action).toBe("flag_needs_review");
  });
  it("flags the absolute 20,000 cap even with no funding data", () => {
    expect(checkHeadcountOutlier(25_000, null)?.rule).toBe("headcount_outlier");
  });
  it("passes a plausible headcount", () => {
    expect(checkHeadcountOutlier(250, 206_000_000)).toBeNull();
  });
});

describe("checkRoundValuation", () => {
  it("drops a valuation that isn't above the round amount", () => {
    const issue = checkRoundValuation({ amount_raised: 50_000_000, valuation: 40_000_000 });
    expect(issue?.rule).toBe("valuation_below_round");
    expect(issue?.action).toBe("drop_field");
  });
  it("passes a normal round (amount well below valuation)", () => {
    expect(checkRoundValuation({ amount_raised: 200_000_000, valuation: 2_300_000_000 })).toBeNull();
  });
});

describe("checkRoundDate", () => {
  it("rejects a future date", () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    expect(checkRoundDate({ announcement_date: future }, null)?.rule).toBe("round_date_invalid");
  });
  it("rejects a round dated before the company was founded", () => {
    expect(checkRoundDate({ announcement_date: "2020-01-01" }, 2022)?.rule).toBe("round_date_invalid");
  });
  it("passes a normal round date", () => {
    expect(checkRoundDate({ announcement_date: "2023-06-22" }, 2022)).toBeNull();
  });
});

describe("checkStageOrder", () => {
  it("flags a later series dated well before an earlier one", () => {
    const rounds: RoundLike[] = [
      { round_type: "Series A", announcement_date: "2023-01-01" },
      { round_type: "Series B", announcement_date: "2022-01-01" }, // a year BEFORE Series A
    ];
    const issues = checkStageOrder(rounds);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("stage_order");
  });
  it("does not flag the real Apex sequence (correctly ordered)", () => {
    const rounds: RoundLike[] = [
      { round_type: "Seed", announcement_date: "2022-10-24" },
      { round_type: "Series A", announcement_date: "2023-06-22" },
      { round_type: "Series B", announcement_date: "2024-06-12" },
      { round_type: "Series C", announcement_date: "2025-04" },
      { round_type: "Series D", announcement_date: "2025-09" },
    ];
    expect(checkStageOrder(rounds)).toHaveLength(0);
  });
});

describe("checkProfileCountryConflict", () => {
  it("never overwrites a manually-verified country", () => {
    const issue = checkProfileCountryConflict(
      { value: "United Kingdom", is_manually_verified: true },
      "United States", "news",
    );
    expect(issue?.action).toBe("keep_existing");
  });
  it("lets a higher-ranked source correct a lower-ranked one", () => {
    const issue = checkProfileCountryConflict(
      { value: "United States", source_type: "model_inferred" },
      "United Kingdom", "registry",
    );
    expect(issue).toBeNull(); // no issue raised -- new value wins, free to write
  });
  it("keeps the existing value and flags for review when ranks tie", () => {
    const issue = checkProfileCountryConflict(
      { value: "United States", source_type: "news" },
      "United Kingdom", "news",
    );
    expect(issue?.action).toBe("keep_existing");
    expect(issue?.needsExternalResolution).toBe(true);
  });
  it("passes silently when the countries already agree", () => {
    expect(checkProfileCountryConflict({ value: "Israel" }, "Israel", "news")).toBeNull();
  });
});

describe("validateEnrichment — end to end on the real Apex case", () => {
  it("accepts a consistent profile/round set with no issues", () => {
    const result = validateEnrichment({
      existing: { founded_year: null, employee_count: null },
      extracted: { founded_year: 2022, city: "Los Angeles", country: "United States", employee_count: 220 },
      rounds: [
        { round_type: "Seed", amount_raised: 7_500_000, announcement_date: "2022-10-24" },
        { round_type: "Series A", amount_raised: 16_000_000, announcement_date: "2023-06-22" },
      ],
      totalRaisedUsd: 23_500_000,
    });
    expect(result.issues).toHaveLength(0);
    expect(result.accepted.founded_year).toBe(2022);
    expect(result.accepted.city).toBe("Los Angeles");
    expect(result.acceptedRounds).toHaveLength(2);
  });

  it("reproduces and catches BOTH literal APEX production bugs in one pass", () => {
    const result = validateEnrichment({
      existing: { founded_year: null, employee_count: null },
      extracted: {
        // The two real production bugs from the spec, combined:
        founded_year: 2026,              // after its own funding history starts
        city: "Los Angeles", country: "United Kingdom", // mixed from two sources
        employee_count: null,
      },
      rounds: [
        { round_type: "Seed", amount_raised: 7_500_000, announcement_date: "2022-10-24" },
      ],
      totalRaisedUsd: 7_500_000,
    });
    const rules = result.issues.map((i) => i.rule);
    expect(rules).toContain("founded_after_first_round");
    expect(rules).toContain("city_country_mismatch");
    expect(result.accepted.founded_year).toBeNull();
    expect(result.accepted.city).toBeNull();
    expect(result.accepted.country).toBeNull();
  });
});

describe("validateEnrichment — Fresha headcount bug", () => {
  it("flags 140,000 employees against $206M raised and withholds the write", () => {
    const result = validateEnrichment({
      existing: { founded_year: null, employee_count: 300 },
      extracted: { employee_count: 140_000 },
      rounds: [],
      totalRaisedUsd: 206_000_000,
    });
    expect(result.issues.some((i) => i.rule === "headcount_outlier")).toBe(true);
    expect(result.accepted.employee_count).toBeNull();
  });
});
