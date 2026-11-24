import { describe, it, expect } from "vitest";
import { preferBetterRoundSources, sourceRank } from "./roundSourcePreference.ts";

const src = (id: string, url: string, content: string, type = "web_search") => ({ source_id: id, url, title: "", content, source_type: type } as never);
const quote = "Lendo secures $28 million in Series B funding led by Sanabil Investments";
const round = (sid: string) => ({ round_type: "Series B", amount_raised: { value: 28_000_000, source_id: sid, evidence_quote: quote }, lead_investor: { value: "Sanabil Investments", source_id: sid, evidence_quote: quote } }) as never;

describe("which source a round rests on (owner, 2026-11-24: Lendo / einpresswire)", () => {
  it("ranks the company's own site, then articles, then wires, then paid distribution", () => {
    expect(sourceRank({ url: "https://www.lendo.sa/en/press", source_type: "company_site" } as never)).toBe(0);
    expect(sourceRank({ url: "https://www.forbesmiddleeast.com/x", source_type: "web_search" } as never)).toBe(1);
    expect(sourceRank({ url: "https://www.prnewswire.com/x", source_type: "web_search" } as never)).toBe(2);
    expect(sourceRank({ url: "https://www.einpresswire.com/article/1", source_type: "web_search" } as never)).toBe(3);
  });
  it("moves a field from the paid page to the company's own page that holds the same sentence", () => {
    const sources = [src("S1", "https://www.einpresswire.com/article/673", `${quote}. More text.`), src("W1", "https://www.lendo.sa/en/press-releases/series-b", `Press release: ${quote}.`, "company_site")];
    const r = [round("S1")]; const moved = preferBetterRoundSources(r as never, sources, "Lendo");
    expect(moved.length).toBe(2);
    expect((r[0] as { amount_raised: { source_id: string } }).amount_raised.source_id).toBe("W1");
  });
  it("leaves it alone when no better page holds the quote", () => {
    const sources = [src("S1", "https://www.einpresswire.com/article/673", quote), src("W1", "https://www.lendo.sa/en/about", "Lendo is a lender.", "company_site")];
    const r = [round("S1")];
    expect(preferBetterRoundSources(r as never, sources, "Lendo")).toEqual([]);
    expect((r[0] as { amount_raised: { source_id: string } }).amount_raised.source_id).toBe("S1");
  });
  it("never moves a field to a worse source", () => {
    const sources = [src("W1", "https://www.lendo.sa/en/press", quote, "company_site"), src("S2", "https://www.einpresswire.com/article/1", quote)];
    const r = [round("W1")];
    expect(preferBetterRoundSources(r as never, sources, "Lendo")).toEqual([]);
  });
});
