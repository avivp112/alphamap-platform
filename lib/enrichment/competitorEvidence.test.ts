import { describe, it, expect } from "vitest";
import { competitorEvidenceProblem, isListingPage } from "./competitorEvidence";
import { buildLabeledSources, classifySourceType, type RawSearchResult } from "./sources";

const raw: RawSearchResult[] = [
  // The 2026-10-26 run: Chalice's Powerlytics and Algocraft came from this LeadIQ page.
  { url: "https://leadiq.com/c/chalice-ai/5f36ed2fa0cf8ca20b588f2e", title: "Chalice AI - Overview, News & Similar companies | LeadIQ", provider: "jina", query_label: "competitors",
    content: "Chalice AI. Advertising Services. Similar companies: Powerlytics, Algocraft, Nano Interactive." },
  { url: "https://www.g2.com/products/ghost/competitors/alternatives", title: "Top Ghost Alternatives", provider: "serper", query_label: "competitors",
    content: "The best Ghost alternatives include Substack, WordPress.com, and Beehiiv. Many creators compare Ghost vs Substack." },
  { url: "https://www.adexchanger.com/data-driven-thinking/custom-bidding-gets-crowded/", title: "Custom Bidding Gets Crowded", provider: "serper", query_label: "competitors",
    content: "Chalice Custom Algorithms is an early rival to Cognitiv in custom bidding for programmatic buyers. Powerlytics is listed as a similar company." },
  { url: "https://www.prnewswire.com/news-releases/1ahead-glo-launch.html", title: "1AHEAD Technologies launches GLO", provider: "serper", query_label: "news",
    content: "CHARLOTTE, N.C. — 1AHEAD Technologies' GLO product directly competes with Ring in AI-driven entry management." },
  { url: "https://www.example-news.com/ai-adtech/top-10-chalice-alternatives", title: "Top 10 Chalice Alternatives in 2026", provider: "serper", query_label: "competitors",
    content: "1. Cognitiv competes with Chalice on custom bidding. 2. Powerlytics." },
];
const sources = buildLabeledSources(raw, "chalice.ai");
const id = (urlPart: string) => sources.find((s) => s.url.includes(urlPart))!.source_id;

describe("a competitor needs a primary source that says it competes (run of 2026-10-26)", () => {
  it("drops Chalice's Powerlytics — LeadIQ's 'similar companies' list is a data platform", () => {
    expect(competitorEvidenceProblem({ name: "Powerlytics", source_id: id("leadiq"), evidence_quote: "Similar companies: Powerlytics, Algocraft" }, sources))
      .toBe("competitor_from_data_platform");
  });

  it("drops a review site's 'alternatives' page and a 'top 10 alternatives' listicle", () => {
    expect(competitorEvidenceProblem({ name: "Substack", source_id: id("g2.com"), evidence_quote: "Many creators compare Ghost vs Substack" }, sources)).toBe("competitor_from_listing");
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("top-10"), evidence_quote: "Cognitiv competes with Chalice on custom bidding" }, sources)).toBe("competitor_from_listing");
  });

  it("drops 'listed as a similar company' even in an article — that is a listing's words", () => {
    expect(competitorEvidenceProblem({ name: "Powerlytics", source_id: id("adexchanger"), evidence_quote: "Powerlytics is listed as a similar company." }, sources))
      .toBe("competitor_quote_not_explicit");
  });

  it("drops a competitor with no quote, or a quote the source does not contain", () => {
    expect(competitorEvidenceProblem({ name: "Algocraft" }, sources)).toBe("competitor_no_evidence");
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("adexchanger"), evidence_quote: "Cognitiv competes head-to-head with Chalice" }, sources))
      .toBe("competitor_quote_not_in_source");
  });

  it("keeps a competitor an article or a press release states: Cognitiv for Chalice, Ring for 1AHEAD", () => {
    expect(competitorEvidenceProblem({ name: "Cognitiv", source_id: id("adexchanger"), evidence_quote: "Chalice Custom Algorithms is an early rival to Cognitiv in custom bidding" }, sources)).toBeNull();
    expect(competitorEvidenceProblem({ name: "Ring", source_id: id("prnewswire"), evidence_quote: "1AHEAD Technologies' GLO product directly competes with Ring" }, sources)).toBeNull();
  });

  it("recognises a data platform by any of its subdomains — BETA's debt round came from app.dealroom.co", () => {
    expect(classifySourceType("https://app.dealroom.co/companies/beta_air_1")).toBe("aggregator_snippet");
    expect(classifySourceType("https://flanders.dealroom.co/companies/beta_air_1")).toBe("aggregator_snippet");
    expect(classifySourceType("https://leadiq.com/c/chalice-ai/5f36ed2fa0cf8ca20b588f2e")).toBe("aggregator_snippet");
    expect(classifySourceType("https://www.adexchanger.com/x")).toBe("news");
  });

  it("does not treat the company's own comparison page as a listing", () => {
    expect(isListingPage({ url: "https://ghost.org/vs/substack/", title: "Ghost vs Substack", source_type: "company_site" })).toBe(false);
  });
});
