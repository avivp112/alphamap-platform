import { describe, it, expect } from "vitest";
import { capitalKind, equityRaised, debtRaised } from "./capital";
import { capitalKind as enrichmentCapitalKind, CANONICAL_ROUND_TYPES } from "../../lib/enrichment/rounds";

describe("the site shows debt apart from Total Raised (BETA, 2026-10-26)", () => {
  it("BETA's $169M loan is not 'Total Raised'", () => {
    const rounds = [{ round_type: "Debt", amount_raised: 169_000_000 }];
    expect(equityRaised(rounds)).toBe(0);
    expect(debtRaised(rounds)).toBe(169_000_000);
  });

  it("classifies every round type exactly as enrichment does", () => {
    for (const t of CANONICAL_ROUND_TYPES) expect(capitalKind(t), t).toBe(enrichmentCapitalKind(t));
  });
});
