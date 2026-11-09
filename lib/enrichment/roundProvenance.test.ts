import { describe, it, expect } from "vitest";
import { roundFieldEvidence } from "./roundProvenance";
import type { V2Round } from "./extractFunding";

const ev = <T,>(value: T, source_id: string, evidence_quote: string) => ({ value, source_id, evidence_quote });

// Apex: the same $200M round reported twice (spec issue 5); after dedup one
// round is written, and each of its values must point at a quote that says it.
const extracted: V2Round[] = [
  {
    round_type: "Series D",
    amount_raised: ev(200_000_000, "S1", "Apex raised $200 million in a Series D led by Glade Brook"),
    lead_investor: ev("Glade Brook Capital", "S1", "Apex raised $200 million in a Series D led by Glade Brook Capital"),
    announcement_date: ev("2026-04-10", "S1", "April 10, 2026 — Apex raised $200 million"),
  },
  {
    round_type: "Growth",
    amount_raised: ev(200_000_000, "S4", "a $200M growth round"),
    valuation: ev(2_300_000_000, "S4", "at a $2.3 billion valuation"),
  },
  {
    round_type: "Series C",
    amount_raised: ev(95_000_000, "S2", "a $95 million Series C"),
  },
];

describe("roundFieldEvidence", () => {
  it("finds a verified quote for every written value of a merged round", () => {
    const got = roundFieldEvidence(
      { round_type: "Series D", amount_raised: 200_000_000, valuation: 2_300_000_000, announcement_date: "2026-04-10", lead_investor: "Glade Brook Capital" },
      extracted,
    );
    expect(got.map((g) => [g.field, g.source_id])).toEqual([
      ["amount_raised", "S1"],      // S1 agrees on amount, date and lead — preferred over S4
      ["valuation", "S4"],          // only S4 states the valuation
      ["announcement_date", "S1"],
      ["lead_investor", "S1"],
    ]);
  });

  it("matches a lead investor and a date written another way", () => {
    const got = roundFieldEvidence({ lead_investor: "glade brook capital", announcement_date: "2026-04-10" }, extracted);
    expect(got.map((g) => g.field)).toEqual(["announcement_date", "lead_investor"]);
  });

  it("writes no row for a value no extracted round carries", () => {
    expect(roundFieldEvidence({ amount_raised: 50_000_000, lead_investor: "Accel" }, extracted)).toEqual([]);
  });

  it("skips empty values", () => {
    expect(roundFieldEvidence({ amount_raised: null, valuation: undefined }, extracted)).toEqual([]);
  });
});

import { evidencedFillPatch } from "./roundProvenance";
describe("evidencedFillPatch — no round value without a source (owner, 2026-11-09)", () => {
  const extracted = [{ round_type: "Series B", lead_investor: { value: "Lakestar", source_id: "S1", evidence_quote: "led by Lakestar" }, amount_raised: { value: 37_000_000, source_id: "S1", evidence_quote: "€37 million" } }] as never;
  it("investor lists never fill a round on file (Adaptive Shield, Appcharge, Upside)", () => {
    expect(evidencedFillPatch({ investors: ["Existing investors"], investor_amounts: {} }, extracted)).toBeNull();
  });
  it("a column no source backs is removed; the backed one stays", () => {
    expect(evidencedFillPatch({ lead_investor: "Lakestar", valuation: 500_000_000, investors: ["A"] }, extracted)).toEqual({ lead_investor: "Lakestar" });
  });
  it("nothing backed, nothing written", () => {
    expect(evidencedFillPatch({ valuation: 500_000_000 }, extracted)).toBeNull();
  });
});
