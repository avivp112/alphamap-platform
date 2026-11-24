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
    expect(moved.length).toBe(1);
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
  it("when the own page does not hold the quote, a sentence of it that carries the same fact stands in (a wire reprints with another headline)", () => {
    const own = "Riyadh — Lendo, the Saudi lending platform, announced it has raised $28 million in a Series B round led by Sanabil Investments, a PIF company. Lendo plans an IPO.";
    const sources = [src("S1", "https://www.einpresswire.com/article/673", `${quote}. More text.`), src("W1", "https://www.lendo.sa/en/press-releases/series-b", own, "company_site")];
    const r = [round("S1")]; const moved = preferBetterRoundSources(r as never, sources, "Lendo");
    expect(moved.length).toBe(1);
    const x = r[0] as { amount_raised: { source_id: string; evidence_quote: string }; lead_investor: { source_id: string } };
    expect(x.amount_raised.source_id).toBe("W1"); expect(x.amount_raised.evidence_quote).toContain("$28 million");
    expect(x.amount_raised.evidence_quote).toContain("led by Sanabil Investments");
    expect(own).toContain(x.amount_raised.evidence_quote);   // verbatim
    expect(x.lead_investor.source_id).toBe("S1");   // the lead's own evidence is never moved alone
  });
  it("a lead the amount's quote names is not left unnamed by the move: the amount moves only to a sentence that says both (owner, 2026-11-24: Lendo, Lulalend lost their lead)", () => {
    const ownOnlyAmount = "Lendo announced it has raised $28 million in a Series B round. The round was led by Sanabil Investments.";
    const ownBoth = "Lendo announced it has raised $28 million in a Series B round led by Sanabil Investments.";
    const lead = (id: string) => ({ round_type: "Series B", amount_raised: { value: 28_000_000, source_id: id, evidence_quote: quote }, lead_investor: { value: "Sanabil Investments", source_id: id, evidence_quote: quote } }) as never;
    // the amount and the lead stand in two sentences of the own page: the amount's quote would lose the lead — it stays where it is
    const r1 = [lead("S1")]; preferBetterRoundSources(r1 as never, [src("S1", "https://www.einpresswire.com/a", quote), src("W1", "https://www.lendo.sa/p", "Lendo announced it has raised $28 million in a Series B round. It plans an IPO. The round was backed by Sanabil Investments.", "company_site")], "Lendo");
    expect((r1[0] as { amount_raised: { source_id: string } }).amount_raised.source_id).toBe("S1");
    // the lead in the next sentence: the two sentences together are the amount's quote
    const r3 = [lead("S1")]; preferBetterRoundSources(r3 as never, [src("S1", "https://www.einpresswire.com/a", quote), src("W1", "https://www.lendo.sa/p", ownOnlyAmount, "company_site")], "Lendo");
    const q3 = (r3[0] as { amount_raised: { source_id: string; evidence_quote: string } }).amount_raised;
    expect(q3.source_id).toBe("W1"); expect(q3.evidence_quote).toBe(ownOnlyAmount); expect(ownOnlyAmount).toContain(q3.evidence_quote);
    // one sentence says both: it moves
    const r2 = [lead("S1")]; preferBetterRoundSources(r2 as never, [src("S1", "https://www.einpresswire.com/a", quote), src("W1", "https://www.lendo.sa/p", ownBoth, "company_site")], "Lendo");
    expect((r2[0] as { amount_raised: { source_id: string } }).amount_raised.source_id).toBe("W1");
  });
  it("the headline of a press release on the company's own site is a valid quote when it states the amount (owner, 2026-11-24: Lendo Series B)", () => {
    const title = "Lendo Secures $28M in Series B Funding Led by Sanabil Investments";
    const mk = () => [round("S1")];
    const own = (t: string, type = "company_site") => ({ source_id: "W1", url: "https://www.lendo.sa/en/press-releases/series-b", title: t, content: "Riyadh. Read more.", source_type: type } as never);
    const r = mk(); const moved = preferBetterRoundSources(r as never, [src("S1", "https://www.einpresswire.com/a", quote), own(title)], "Lendo");
    expect(moved.length).toBe(1);
    const a = (r[0] as { amount_raised: { source_id: string; evidence_quote: string }; source_url?: string }).amount_raised;
    expect(a.source_id).toBe("W1"); expect(a.evidence_quote).toBe(title);
    const r3 = mk(); preferBetterRoundSources(r3 as never, [src("S1", "https://www.einpresswire.com/a", quote), own("Lendo Secures $28M in Series B Funding Led by Other Capital")], "Lendo");
    expect((r3[0] as { amount_raised: { source_id: string } }).amount_raised.source_id).toBe("S1");   // another lead
  });
});
