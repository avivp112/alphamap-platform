import { describe, it, expect } from "vitest";
import {
  buildMarketExtractionRequest, processMarketExtractionResponse, termAppearsIn, normalizeUrlForMatch,
} from "./extractMarket";
import { buildLabeledSources, type RawSearchResult } from "./sources";

const raw: RawSearchResult[] = [
  {
    url: "https://www.g2.com/products/ghost/competitors/alternatives", title: "Top Ghost Alternatives", provider: "serper", query_label: "competitors",
    content: "The best Ghost alternatives include Substack, WordPress.com, and Beehiiv. Many creators compare Ghost vs Substack.",
  },
  {
    url: "https://techcrunch.com/2024/05/01/ghost-launches-activitypub/", title: "Ghost launches ActivityPub support", provider: "serper", query_label: "news",
    content: "Source: TechCrunch — Date: 2024-05-01 — Ghost, the open source publishing platform, launched ActivityPub support.",
  },
  {
    url: "https://www.crunchbase.com/organization/ghost", title: "Ghost - Crunchbase Company Profile", provider: "serper", query_label: "profile",
    content: "Ghost is a publishing platform founded in 2013.",
  },
  {
    url: "https://ghost.org/careers", title: "Careers", provider: "jina", query_label: "website",
    content: "We build with Node.js, Ember and MySQL. Join our distributed team.",
  },
  {
    url: "https://patents.google.com/patent/US1234567B2", title: "US1234567B2 - Publishing system", provider: "serper", query_label: "patents",
    content: "US1234567B2 Publishing system for membership content. Assignee: Ghost Foundation.",
  },
];
const sources = buildLabeledSources(raw, "ghost.org");

describe("buildMarketExtractionRequest", () => {
  const req = buildMarketExtractionRequest("Ghost", sources, "2026-10-05");
  it("forces its own tool, includes today's date for relative news dates, and names the competitor evidence types", () => {
    expect(req.tool_choice).toEqual({ type: "tool", name: "save_market_extraction" });
    const text = req.messages[0].content as string;
    expect(text).toContain("Today's date is 2026-10-05");
    expect(text).toContain("alternatives to Ghost");
    expect(text).toContain("never add a well-known company from your own knowledge");
  });
});

describe("termAppearsIn", () => {
  it("matches whole names case-insensitively, including at the end of a sentence", () => {
    expect(termAppearsIn("Substack", "creators compare Ghost vs Substack.")).toBe(true);
    expect(termAppearsIn("wordpress.com", "include Substack, WordPress.com, and Beehiiv")).toBe(true);
  });
  it("does not match a substring of a longer word", () => {
    expect(termAppearsIn("Sub", "Substack")).toBe(false);
  });
});

describe("normalizeUrlForMatch", () => {
  it("ignores protocol, www, query string, and trailing slash", () => {
    expect(normalizeUrlForMatch("https://www.techcrunch.com/a/b/?utm=x")).toBe(normalizeUrlForMatch("http://techcrunch.com/a/b"));
  });
});

describe("processMarketExtractionResponse", () => {
  it("keeps competitors named in a source and drops ones only the model knows about", () => {
    const { result, dropped } = processMarketExtractionResponse({
      competitors: [
        { name: "Substack", how_it_competes: "Newsletter platform.", source_ids: ["S1"] },
        { name: "Medium", how_it_competes: "Blogging platform.", source_ids: ["S1"] }, // not in any source
      ],
      news: [],
    }, sources, "Ghost");
    expect(result.competitors.map((c) => c.name)).toEqual(["Substack"]);
    expect(dropped).toContainEqual({ field: "competitors", reason: "competitor_not_in_source" });
  });

  it("never lists the company as its own competitor", () => {
    const { result } = processMarketExtractionResponse({
      competitors: [{ name: "Ghost", how_it_competes: "x", source_ids: ["S1"] }], news: [],
    }, sources, "Ghost");
    expect(result.competitors).toHaveLength(0);
  });

  it("keeps a news article whose URL is a fetched source, and drops invented URLs and profile pages", () => {
    const { result, dropped } = processMarketExtractionResponse({
      competitors: [],
      news: [
        { title: "Ghost launches ActivityPub support", url: "https://techcrunch.com/2024/05/01/ghost-launches-activitypub", published_date: "2024-05-01", source: "TechCrunch" },
        { title: "Invented", url: "https://example.com/made-up-article" },
        { title: "Ghost - Crunchbase", url: "https://www.crunchbase.com/organization/ghost" },
      ],
    }, sources, "Ghost");
    expect(result.news).toHaveLength(1);
    expect(result.news[0].url).toBe("https://techcrunch.com/2024/05/01/ghost-launches-activitypub/");
    expect(dropped).toContainEqual({ field: "news", reason: "news_url_not_in_sources" });
    expect(dropped).toContainEqual({ field: "news", reason: "news_is_profile_page" });
  });

  it("keeps tech stack terms a source names and drops inferred ones", () => {
    const { result } = processMarketExtractionResponse({
      competitors: [], news: [], technology: { tech_stack: ["Node.js", "MySQL", "Kubernetes"] },
    }, sources, "Ghost");
    expect(result.technology.tech_stack).toEqual(["Node.js", "MySQL"]);
  });

  it("keeps a patent whose number appears in a source", () => {
    const { result } = processMarketExtractionResponse({
      competitors: [], news: [], patents: [{ title: "Publishing system", patent_number: "US1234567B2" }, { title: "Teleportation device", patent_number: "US9999999" }],
    }, sources, "Ghost");
    expect(result.patents.map((p) => p.patent_number)).toEqual(["US1234567B2"]);
  });

  it("does not crash when the model collapses a one-item list into a bare object", () => {
    expect(() => processMarketExtractionResponse({
      competitors: { name: "Substack", how_it_competes: "x", source_ids: ["S1"] },
      news: { title: "t", url: "https://techcrunch.com/2024/05/01/ghost-launches-activitypub/" },
      patents: { title: "Publishing system", patent_number: "US1234567B2" },
    }, sources, "Ghost")).not.toThrow();
  });
});
