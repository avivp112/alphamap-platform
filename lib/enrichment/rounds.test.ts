import { describe, it, expect } from "vitest";
import {
  normalizeRoundType, investorNamesMatch, classifyRoundPair, mergeRoundPair,
  dedupRounds, computeTotalRaised, type RoundLike,
} from "./rounds";

describe("normalizeRoundType", () => {
  it("maps common free-text variants to the canonical list", () => {
    expect(normalizeRoundType("series a")).toBe("Series A");
    expect(normalizeRoundType("Series D")).toBe("Series D");
    expect(normalizeRoundType("growth round")).toBe("Growth");
    expect(normalizeRoundType("SAFE")).toBe("Convertible Note");
    expect(normalizeRoundType("Acquired by Palantir")).toBe("Acquired");
    expect(normalizeRoundType("NASDAQ listing")).toBe("IPO");
    expect(normalizeRoundType(null)).toBe("Unknown");
  });
});

describe("investorNamesMatch", () => {
  it("matches exact and substring forms of the same firm", () => {
    expect(investorNamesMatch("Glade Brook Capital Partners", "Glade Brook Capital Partners")).toBe(true);
    expect(investorNamesMatch("Glade Brook", "Glade Brook Capital Partners")).toBe(true);
  });
  it("does not match genuinely different firms", () => {
    expect(investorNamesMatch("Interlagos", "Glade Brook Capital Partners")).toBe(false);
  });
  it("never matches when either side is missing", () => {
    expect(investorNamesMatch(null, "Glade Brook")).toBe(false);
    expect(investorNamesMatch("Glade Brook", undefined)).toBe(false);
  });
});

// Real, independently-verified Apex Space funding history (see
// eval/golden_set.json, apex-space) — six genuinely distinct events,
// including three separate $200M rounds within ~14 months. This is the
// ground truth the production bug report got wrong by assuming two of
// these were the same event stored twice.
const apexRealRounds: RoundLike[] = [
  { round_type: "Seed", amount_raised: 7_500_000, announcement_date: "2022-10-24", lead_investor: "Andreessen Horowitz" },
  { round_type: "Series A", amount_raised: 16_000_000, announcement_date: "2023-06-22", lead_investor: "Andreessen Horowitz / Shield Capital (co-leads)" },
  { round_type: "Series B", amount_raised: 95_000_000, announcement_date: "2024-06-12", lead_investor: "XYZ Venture Capital / CRV (co-leads)" },
  { round_type: "Series C", amount_raised: 200_000_000, announcement_date: "2025-04", lead_investor: "Point72 Ventures / 8VC (co-leads)", valuation: null },
  { round_type: "Series D", amount_raised: 200_000_000, announcement_date: "2025-09", lead_investor: null, valuation: 1_000_000_000 },
  { round_type: "Growth", amount_raised: 200_000_000, announcement_date: "2026-06-05", lead_investor: "Glade Brook Capital Partners", valuation: 2_300_000_000 },
];

describe("classifyRoundPair — real Apex data (must NOT merge distinct rounds)", () => {
  it("Series D and Growth are >270 days apart — not even a candidate pair", () => {
    expect(classifyRoundPair(apexRealRounds[4], apexRealRounds[5])).toBeNull();
  });
  it("Series C and Series D: same amount, but no corroborating investor or valuation match", () => {
    expect(classifyRoundPair(apexRealRounds[3], apexRealRounds[4])).toBeNull();
  });
  it("no two of the six real rounds are misclassified as duplicates", () => {
    const result = dedupRounds(apexRealRounds);
    expect(result.rounds).toHaveLength(6);
    expect(result.merged).toHaveLength(0);
    expect(result.needsReview).toHaveLength(0);
  });
  it("Total Raised recomputes to the verified $718.5M across all six rounds", () => {
    expect(computeTotalRaised(apexRealRounds)).toBe(718_500_000);
  });
});

describe("classifyRoundPair — the literal production bug scenario", () => {
  // This is what the spec's bug report actually describes: a "Series D"
  // dated Apr 2026 and a "Growth" round dated Jun 2026, both $200M at a
  // $2.3B valuation, but — per the bug report — both attributed to Glade
  // Brook. If the production data genuinely has conflicting investor names
  // on the two stored rows (as our own Apex research found the real two
  // closest-in-time $200M rounds do), this must be flagged for a human,
  // never silently merged, since one of several real distinct rounds could
  // legitimately look like this on paper.
  const seriesD: RoundLike = {
    round_type: "Series D", amount_raised: 200_000_000, announcement_date: "2026-04-01",
    lead_investor: "Interlagos", valuation: 2_300_000_000,
  };
  const growth: RoundLike = {
    round_type: "Growth", amount_raised: 200_000_000, announcement_date: "2026-06-05",
    lead_investor: "Glade Brook Capital Partners", valuation: 2_300_000_000,
  };

  it("flags possible_duplicate_needs_review rather than auto-merging on conflicting investors", () => {
    expect(classifyRoundPair(seriesD, growth)).toBe("possible_duplicate_needs_review");
  });
  it("dedupRounds keeps both rounds and surfaces the pair for review, not merged", () => {
    const result = dedupRounds([seriesD, growth]);
    expect(result.rounds).toHaveLength(2);
    expect(result.merged).toHaveLength(0);
    expect(result.needsReview).toHaveLength(1);
  });

  it("but if the two rows genuinely DO agree on investor, it auto-merges (a true duplicate)", () => {
    const dup: RoundLike = { ...seriesD, lead_investor: "Glade Brook Capital Partners" };
    expect(classifyRoundPair(dup, growth)).toBe("duplicate");
    const result = dedupRounds([dup, growth]);
    expect(result.rounds).toHaveLength(1);
    expect(result.merged).toHaveLength(1);
    // Most specific type wins (Series D over the generic "Growth" bucket).
    expect(result.rounds[0].round_type).toBe("Series D");
  });
});

describe("mergeRoundPair", () => {
  it("keeps the earliest date, the more specific type, and unions investors", () => {
    const a: RoundLike = { round_type: "Growth", amount_raised: 50_000_000, announcement_date: "2024-03-01", lead_investor: "Acme Capital", other_investors: ["Beta Fund"] };
    const b: RoundLike = { round_type: "Series C", amount_raised: 52_000_000, announcement_date: "2024-01-15", lead_investor: "Acme Capital", other_investors: ["Gamma VC"] };
    const merged = mergeRoundPair(a, b);
    expect(merged.round_type).toBe("Series C");
    expect(merged.announcement_date).toBe("2024-01-15");
    expect(merged.other_investors).toEqual(expect.arrayContaining(["Beta Fund", "Gamma VC"]));
  });
});

// Fresha's real, independently-verified rounds (eval/golden_set.json,
// fresha) — four distinct events, amounts far enough apart that none should
// ever pair up.
const freshaRealRounds: RoundLike[] = [
  { round_type: "Series A", amount_raised: 6_000_000, announcement_date: "2017-06-08", lead_investor: "Middle East Venture Partners" },
  { round_type: "Series B", amount_raised: 20_000_000, announcement_date: "2019", lead_investor: "Partech", valuation: 105_000_000 },
  { round_type: "Series C", amount_raised: 100_000_000, announcement_date: "2021-06-11", lead_investor: "General Atlantic" },
  { round_type: "Growth", amount_raised: 80_000_000, announcement_date: "2026-05-22", lead_investor: "KKR", valuation: 1_000_000_000 },
];

describe("Fresha — real data sanity check", () => {
  it("all four rounds stay distinct", () => {
    const result = dedupRounds(freshaRealRounds);
    expect(result.rounds).toHaveLength(4);
    expect(result.merged).toHaveLength(0);
    expect(result.needsReview).toHaveLength(0);
  });
  it("Total Raised recomputes to the verified $206M", () => {
    expect(computeTotalRaised(freshaRealRounds)).toBe(206_000_000);
  });
});

describe("computeTotalRaised", () => {
  it("excludes Secondary, IPO, Acquired and PE Buyout rows", () => {
    const rounds: RoundLike[] = [
      { round_type: "Series A", amount_raised: 10_000_000 },
      { round_type: "Secondary", amount_raised: 999_000_000 },
      { round_type: "IPO", amount_raised: 500_000_000 },
    ];
    expect(computeTotalRaised(rounds)).toBe(10_000_000);
  });
});
