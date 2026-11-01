import { describe, it, expect } from "vitest";
import { currencyOfAmount, toUsd, formatOriginal } from "./currency";
import { roundToRoundLike } from "./extractFunding";

describe("a round keeps the currency its source states (owner, 2026-11-01: Helsing's €102.5M written as $100M)", () => {
  it("reads the currency next to the figure", () => {
    expect(currencyOfAmount(102_500_000, "Helsing raised €102.5 million in a Series A led by Daniel Ek's Prima Materia")).toBe("EUR");
    expect(currencyOfAmount(600_000_000, "Helsing has raised 600 million euros in new funding")).toBe("EUR");
    expect(currencyOfAmount(40_000_000, "Synthesia raises £40m")).toBe("GBP");
    expect(currencyOfAmount(116_000_000, "€102.5 million (US$116 million)")).toBe("USD");
    expect(currencyOfAmount(20_000_000, "Wayve raised a $20 million Series A")).toBe("USD");
    expect(currencyOfAmount(20_000_000, "raised 20 million in Series A")).toBe("USD");
    expect(currencyOfAmount(5_000_000, "C$5 million seed")).toBe("CAD");
    expect(currencyOfAmount(9_000_000, "raised $20 million")).toBeNull();
  });
  it("converts at the year's average rate, an estimate; no rate, no USD figure", () => {
    expect(toUsd(102_500_000, "EUR", 2021)).toBe(120_950_000);
    expect(toUsd(10, "USD", 2021)).toBe(10);
    expect(toUsd(1_000_000, "EUR", 2030)).toBe(1_160_000);   // after the table: its latest year
  });
  it("the round keeps the original and gets the USD estimate", () => {
    const r = roundToRoundLike({
      round_type: "Series A",
      amount_raised: { value: 102_500_000, source_id: "S1", evidence_quote: "Helsing raised €102.5 million in a Series A" },
      announcement_date: { value: "2021-11-09", source_id: "S1", evidence_quote: "November 9, 2021" },
    });
    expect([r.amount_raised, r.amount_original, r.amount_currency]).toEqual([120_950_000, 102_500_000, "EUR"]);
    const usd = roundToRoundLike({ round_type: "Series A", amount_raised: { value: 20_000_000, source_id: "S1", evidence_quote: "a $20 million Series A" } });
    expect([usd.amount_raised, usd.amount_currency]).toEqual([20_000_000, undefined]);
  });
  it("shows the source's figure", () => {
    expect(formatOriginal(102_500_000, "EUR")).toBe("€102.5M");
    expect(formatOriginal(20_000_000, "CHF")).toBe("CHF 20M");
  });
});
