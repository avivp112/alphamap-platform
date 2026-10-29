import { describe, it, expect } from "vitest";
import { hintFromRound, hintQueries, confirmHint, hintKey, amountWords, type RoundHint } from "./hints";
import { buildLabeledSources } from "./sources";

const darkowl: RoundHint = {
  round_type: "Growth", amount_raised: 8_000_000, announcement_date: "2024-05-01", lead_investor: "Five Elms Capital",
  source_url: "https://app.dealroom.co/news/note/darkowl-closes-8m-growth-round-led-by-five-elms-capital",
};

describe("a data platform's round is a hint to search for, never a fact (owner, 2026-10-28)", () => {
  it("reads the hint off DarkOwl's Dealroom-only round", () => {
    const sources = buildLabeledSources([{ url: darkowl.source_url!, title: "DarkOwl closes $8M growth round", content: "DarkOwl closes $8M growth round led by Five Elms Capital.", provider: "serper", query_label: "funding_db" }]);
    const h = hintFromRound({
      round_type: "Growth", amount_raised: { value: 8_000_000, source_id: "S1", evidence_quote: "DarkOwl closes $8M growth round" },
      lead_investor: { value: "Five Elms Capital", source_id: "S1", evidence_quote: "led by Five Elms Capital" },
    }, sources);
    expect(h).toEqual({ round_type: "Growth", amount_raised: 8_000_000, announcement_date: null, lead_investor: "Five Elms Capital", source_url: darkowl.source_url });
  });

  it("searches for the raise, the lead investor and an SEC Form D", () => {
    expect(hintQueries("DarkOwl", darkowl)).toEqual([
      ["hint_raise", '"DarkOwl" raises "$8 million" "Growth"'],
      ["hint_lead", '"DarkOwl" "Five Elms Capital" funding round'],
      ["hint_form_d", 'site:sec.gov "DarkOwl" "Form D"'],
    ]);
    expect(amountWords(169_000_000)).toBe("$169 million");
    expect(amountWords(1_500_000_000)).toBe("$1.5 billion");
    expect(amountWords(160_000)).toBe("$160,000");
  });

  it("a press release that states the round confirms it — written with the press release alone", () => {
    const sources = buildLabeledSources([
      { url: darkowl.source_url!, title: "DarkOwl", content: "Growth $8M Five Elms", provider: "serper", query_label: "hint_raise" },
      { url: "https://www.prnewswire.com/news-releases/darkowl-secures-8-million-growth-investment.html", title: "DarkOwl Secures $8 Million Growth Investment from Five Elms Capital",
        content: "DENVER — DarkOwl, a leader in darknet intelligence, today announced it has secured an $8 million growth investment. The round was led by Five Elms Capital.", provider: "serper", query_label: "hint_raise" },
    ]);
    const r = confirmHint(darkowl, sources, "DarkOwl");
    expect(r?.source_url).toBe("https://www.prnewswire.com/news-releases/darkowl-secures-8-million-growth-investment.html");
    expect(r?.amount_raised).toMatchObject({ value: 8_000_000, source_id: "S2" });
    expect(r?.lead_investor?.value).toBe("Five Elms Capital");
  });

  it("an SEC Form D's 'Total Amount Sold' confirms the amount", () => {
    const sources = buildLabeledSources([{ url: "https://www.sec.gov/Archives/edgar/data/1700000/000170000024000001/xslFormDX01/primary_doc.xml", title: "SEC FORM D — DarkOwl, LLC",
      content: "Issuer: DarkOwl, LLC. Total Offering Amount $8,000,000. Total Amount Sold $8,000,000.", provider: "serper", query_label: "hint_form_d" }]);
    expect(confirmHint(darkowl, sources, "DarkOwl")?.amount_raised?.evidence_quote).toBe("Total Amount Sold $8,000,000");
  });

  it("another platform repeating it confirms nothing — Apify's GetLatka rounds stay hints", () => {
    const apify: RoundHint = { round_type: "Seed", amount_raised: 160_000, announcement_date: null, lead_investor: null, source_url: "https://getlatka.com/companies/apify" };
    const sources = buildLabeledSources([
      { url: "https://www.crunchbase.com/organization/apify", title: "Apify", content: "Apify raised $160,000 in Seed funding.", provider: "serper", query_label: "hint_raise" },
      { url: "https://www.premieralts.com/companies/apify", title: "Apify", content: "Apify raised $160,000 Seed.", provider: "serper", query_label: "hint_raise" },
    ]);
    expect(confirmHint(apify, sources, "Apify")).toBeNull();
  });

  it("an article about another company, or one without the amount, confirms nothing", () => {
    const sources = buildLabeledSources([
      { url: "https://techcrunch.com/2024/05/01/other", title: "Recorded Future raises $8M", content: "Recorded Future raised $8 million led by Five Elms Capital.", provider: "serper", query_label: "hint_raise" },
      { url: "https://www.securityweek.com/darkowl", title: "DarkOwl expands", content: "DarkOwl announced new funding led by Five Elms Capital.", provider: "serper", query_label: "hint_lead" },
    ]);
    expect(confirmHint(darkowl, sources, "DarkOwl")).toBeNull();
  });

  it("one key per round: the amount and the month", () => {
    expect(hintKey(darkowl)).toBe("round:8000000:2024-05:");
    expect(hintKey({ ...darkowl, announcement_date: "2024-05-20" })).toBe(hintKey(darkowl));
  });
});
