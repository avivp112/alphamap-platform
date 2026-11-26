import { describe, it, expect } from "vitest";
import { roundFromHeadline, roundsFromNews } from "./newsRounds";
describe("a round from an accepted headline (owner, round 10)", () => {
  it("reads type and amount from the headline", () => {
    expect(roundFromHeadline("Canada's Leading All-In-One HR Platform, Humi, Closes $31M Series B", "Humi")).toMatchObject({ type: "Series B", amount: 31_000_000 });
    expect(roundFromHeadline("Mintifi raises $180 million in funding, valuation soars to $850 million", "Mintifi")).toMatchObject({ type: "Unknown", amount: 180_000_000 });
    expect(roundFromHeadline("Supply chain financing company Mintifi scores $110m Series D", "Mintifi")).toMatchObject({ type: "Series D", amount: 110_000_000 });
    expect(roundFromHeadline("On a Mission to Build HR Software, Paradox Raises $200M Series C", "Paradox AI")).toMatchObject({ type: "Series C", amount: 200_000_000 });
  });
  it("is not a round when the company is not the one raising, or nothing was raised yet", () => {
    expect(roundFromHeadline("Employment Hero acquires Canadian employment platform Humi in $100M+ global expansion move", "Humi")).toBeNull();
    expect(roundFromHeadline("Mintifi plans to raise $200M next year", "Mintifi")).toBeNull();
    expect(roundFromHeadline("Rival Corp raises $50M Series A to take on Mintifi", "Mintifi")).toBeNull();
    expect(roundFromHeadline("Mintifi’s FY25 Profit Surges 56% To INR 145 Cr", "Mintifi")).toBeNull();
  });
  it("needs the news item's date and a source", () => {
    const src: any = { source_id: "S1", url: "https://x/a", title: "", content: "" };
    expect(roundsFromNews([{ title: "Humi Closes $31M Series B", url: "https://x/a", published_date: "2022-05-25" }], "Humi", [src])).toHaveLength(1);
    expect(roundsFromNews([{ title: "Humi Closes $31M Series B", url: "https://x/a" }], "Humi", [src])).toHaveLength(0);
  });
});
