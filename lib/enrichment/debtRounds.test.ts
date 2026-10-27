import { describe, it, expect } from "vitest";
import { groundRoundType, rejectRound, isUnstatedEvent } from "./assemble";
import { capitalKind, computeTotalRaised, computeDebtRaised } from "./rounds";
import { buildLabeledSources } from "./sources";
import type { V2Round } from "./extractFunding";

const ev = <T,>(value: T, source_id: string, evidence_quote: string) => ({ value, source_id, evidence_quote });

// BETA in the 2026-10-26 run: one new round, from Dealroom only.
const betaSources = buildLabeledSources([
  { url: "https://flanders.dealroom.co/companies/beta_air_1", title: "BETA Technologies - Dealroom.co", provider: "serper", query_label: "funding_db",
    content: "BETA Technologies. Debt $169M Oct 2024 Export-Import Bank of the United States." },
  { url: "https://app.dealroom.co/companies/beta_air_1", title: "BETA Technologies", provider: "serper", query_label: "funding_db",
    content: "Funding rounds: Debt · $169M · 2024-10-01 · Export-Import Bank of the United States" },
], "beta.team");
const betaDebt: V2Round = {
  round_type: "Debt",
  amount_raised: ev(169_000_000, "S2", "Debt · $169M · 2024-10-01"),
  lead_investor: ev("Export-Import Bank of the United States", "S1", "Export-Import Bank of the United States"),
  source_url: "https://app.dealroom.co/companies/beta_air_1",
};

describe("a round whose only source is a data platform is not written (BETA, 2026-10-26)", () => {
  it("drops BETA's $169M debt round — cited to app.dealroom.co and flanders.dealroom.co only", () => {
    expect(rejectRound(betaDebt, "BETA Technologies", betaSources)).toBe("round_only_from_data_platform");
  });

  it("keeps the same round once a press release or article states it", () => {
    const withPress = buildLabeledSources([
      ...betaSources.map(({ source_id: _id, source_type: _t, ...r }) => r),
      { url: "https://www.prnewswire.com/news-releases/beta-exim-loan.html", title: "BETA secures $169M", provider: "serper", query_label: "funding",
        content: "BETA Technologies secured a $169 million loan from the Export-Import Bank of the United States." },
    ], "beta.team");
    expect(rejectRound({ ...betaDebt, amount_raised: ev(169_000_000, "S3", "BETA Technologies secured a $169 million loan") }, "BETA Technologies", withPress)).toBeNull();
  });
});

describe("debt is marked and summed apart from equity (BETA, 2026-10-26)", () => {
  it("BETA's $169M loan is debt, not 'total raised $169.0M'", () => {
    const rounds = [{ round_type: "Debt", amount_raised: 169_000_000 }];
    expect(capitalKind("Debt")).toBe("debt");
    expect(computeTotalRaised(rounds)).toBe(0);
    expect(computeDebtRaised(rounds)).toBe(169_000_000);
  });

  it("equity and debt side by side; a secondary or an acquisition is neither", () => {
    const rounds = [
      { round_type: "Series A", amount_raised: 8_000_000 }, { round_type: "Venture Debt", amount_raised: 5_000_000 },
      { round_type: "Secondary", amount_raised: 40_000_000 }, { round_type: "Unknown", amount_raised: 9_000_000 },
    ];
    expect(computeTotalRaised(rounds)).toBe(17_000_000);
    expect(computeDebtRaised(rounds)).toBe(5_000_000);
    expect(capitalKind("Secondary")).toBe("not_capital");
  });

  it("a loan the model labelled with an equity series is debt", () => {
    const s = buildLabeledSources([{ url: "https://news.example.com/a", title: "x", provider: "serper", query_label: "funding",
      content: "The company secured a $20 million credit facility from Silicon Valley Bank." }]);
    const r: V2Round = { round_type: "Series B", amount_raised: ev(20_000_000, "S1", "secured a $20 million credit facility from Silicon Valley Bank") };
    expect(groundRoundType(r, s).round_type).toBe("Debt");
    expect(groundRoundType({ ...r, round_type: "Growth", amount_raised: ev(20_000_000, "S1", "secured a $20 million venture debt facility") }, s).round_type).toBe("Venture Debt");
  });

  it("keeps an equity round whose quote also mentions debt", () => {
    const s = buildLabeledSources([{ url: "https://news.example.com/b", title: "x", provider: "serper", query_label: "funding",
      content: "Acme raised a $50 million Series B and a $20 million credit line." }]);
    expect(groundRoundType({ round_type: "Series B", amount_raised: ev(50_000_000, "S1", "Acme raised a $50 million Series B and a $20 million credit line") }, s).round_type).toBe("Series B");
  });
});

describe("an event no source states is not written as an Unknown round (DarkOwl, Actian — 2026-10-26)", () => {
  it("an unstated Acquired / Secondary is dropped; an unstated Series A becomes Unknown as before", () => {
    expect(isUnstatedEvent("Acquired", "Unknown")).toBe(true);
    expect(isUnstatedEvent("Secondary", "Unknown")).toBe(true);
    expect(isUnstatedEvent("Acquired", "Acquired")).toBe(false);
    expect(isUnstatedEvent("Series A", "Unknown")).toBe(false);
  });
});
