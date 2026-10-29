import { describe, it, expect } from "vitest";
import { hintFromRound, hintQueries, confirmHint, hintKey, amountWords, hintsFromDeletedRounds, canConfirm, type RoundHint } from "./hints";
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

describe("the rounds the 2026-10-28 cleanup deleted become hints (owner, 2026-10-29)", () => {
  it("DarkOwl's Dealroom round and Apify's GetLatka seed become hints; the deleted Acquired / Secondary rows do not", () => {
    const changes = [
      { startup_id: "darkowl", field: "funding_rounds.r1", new_value: null, old_value: { round_type: "Growth", amount_raised: 8_000_000, announcement_date: null, lead_investor: "Five Elms Capital", source_url: "https://app.dealroom.co/news/note/darkowl-closes-8m-growth-round-led-by-five-elms-capital" } },
      { startup_id: "apify", field: "funding_rounds.r2", new_value: null, old_value: { round_type: "Seed", amount_raised: 160_000, source_url: "https://getlatka.com/companies/apify" } },
      { startup_id: "darkowl", field: "funding_rounds.r3", new_value: null, old_value: { round_type: "Acquired", source_url: "https://www.darkowl.com/press-releases/darkowl-purchases-certain-assets-of-skurio-ltd" } },
      { startup_id: "actian", field: "funding_rounds.r4", new_value: null, old_value: { round_type: "Secondary", amount_raised: 150_000_000, source_url: "https://en.wikipedia.org/wiki/Actian" } },
      { startup_id: "biotia", field: "funding_rounds.r5.round_type", new_value: "Unknown", old_value: "Growth" },
    ];
    expect(hintsFromDeletedRounds(changes).map((h) => [h.startup_id, h.round_type, h.amount_raised])).toEqual([["darkowl", "Growth", 8_000_000], ["apify", "Seed", 160_000]]);
  });
});

describe("only a primary source confirms a hint (eval run of 2026-10-29)", () => {
  const sources = (url: string, text: string) => buildLabeledSources([{ url, title: "", content: text, provider: "serper", query_label: "hint_raise" }], "ssi.inc");
  it("an Instagram or Facebook post confirms nothing — SSI's '$2B Series A', Zepto's $350M", () => {
    const ssi: RoundHint = { round_type: "Series A", amount_raised: 2_000_000_000, announcement_date: null, lead_investor: null, source_url: "https://tracxn.com/d/companies/ssi" };
    expect(confirmHint(ssi, sources("https://www.instagram.com/p/DIbhIebiJqm/", "Safe Superintelligence raises $2 billion in Series A funding."), "Safe Superintelligence Inc.")).toBeNull();
    const zepto: RoundHint = { round_type: "Growth", amount_raised: 350_000_000, announcement_date: null, lead_investor: null, source_url: "https://tracxn.com/d/companies/zepto" };
    expect(confirmHint(zepto, sources("https://www.facebook.com/SocialSamosa/posts/965807418907040/", "Zepto has raised $350 million in a fresh round."), "Zepto")).toBeNull();
  });
  it("a blog or a niche site outside the trusted outlets confirms nothing; the company's site, a press wire or a trusted outlet does", () => {
    expect(canConfirm({ url: "https://everything-pr.com/mira-murati-thinking-machines-valuation", source_type: "news" })).toBe(false);
    expect(canConfirm({ url: "https://www.cyera.com/blog/cheers-to-our-300-million-series-c-round", source_type: "company_site" })).toBe(true);
    expect(canConfirm({ url: "https://www.prnewswire.com/news-releases/x.html", source_type: "press_release" })).toBe(true);
    expect(canConfirm({ url: "https://www.calcalistech.com/ctechnews/article/1zb4tfyot", source_type: "news" })).toBe(true);
  });
});

