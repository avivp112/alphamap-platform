import { describe, it, expect } from "vitest";
import {
  buildMarketExtractionRequest, processMarketExtractionResponse, termAppearsIn, normalizeUrlForMatch, newsDateIsGrounded,
} from "./extractMarket";
import { buildLabeledSources, type RawSearchResult } from "./sources";

const raw: RawSearchResult[] = [
  {
    url: "https://www.g2.com/products/ghost/competitors/alternatives", title: "Top Ghost Alternatives", provider: "serper", query_label: "competitors",
    content: "The best Ghost alternatives include Substack, WordPress.com, and Beehiiv. Many creators compare Ghost vs Substack.",
  },
  {
    url: "https://techcrunch.com/2024/05/01/ghost-launches-activitypub/", title: "Ghost launches ActivityPub support", provider: "serper", query_label: "news",
    content: "Source: TechCrunch — Date: 2024-05-01 — Ghost, the open source publishing platform, launched ActivityPub support. Ghost competes with Substack and Beehiiv for paid newsletters.",
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
    expect(text).toContain("EXPLICITLY says compete with Ghost");
    expect(text).toContain("LeadIQ");
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
  it("keeps a competitor an article says competes, and drops one only the model knows about or only an 'alternatives' list names", () => {
    const { result, dropped } = processMarketExtractionResponse({
      competitors: [
        { name: "Substack", how_it_competes: "Newsletter platform.", source_ids: ["S2"], source_id: "S2", evidence_quote: "Ghost competes with Substack and Beehiiv for paid newsletters" },
        { name: "Medium", how_it_competes: "Blogging platform.", source_ids: ["S1"], source_id: "S1", evidence_quote: "Medium" }, // not in any source
        { name: "WordPress.com", how_it_competes: "Blogging platform.", source_ids: ["S1"], source_id: "S1", evidence_quote: "The best Ghost alternatives include Substack, WordPress.com, and Beehiiv" },
      ],
      news: [],
    }, sources, "Ghost");
    expect(result.competitors.map((c) => c.name)).toEqual(["Substack"]);
    expect(dropped).toContainEqual({ field: "competitors", reason: "competitor_not_in_source" });
    expect(dropped).toContainEqual({ field: "competitors", reason: "competitor_from_listing" });
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

  it("keeps no patent read off a page, even one whose number is in a source — patents come from the EPO register only (2026-10-26)", () => {
    const { result, dropped } = processMarketExtractionResponse({
      competitors: [], news: [], patents: [{ title: "Publishing system", patent_number: "US1234567B2" }], patent_summary: { patent_count: 3, patent_fields: ["Publishing"] },
    }, sources, "Ghost");
    expect(result.patents).toEqual([]);
    expect(result.patent_summary).toEqual({ patent_count: null, patent_fields: [] });
    expect(dropped).toContainEqual({ field: "patents", reason: "patent_not_from_register" });
  });

  it("does not crash when the model collapses a one-item list into a bare object", () => {
    expect(() => processMarketExtractionResponse({
      competitors: { name: "Substack", how_it_competes: "x", source_ids: ["S1"] },
      news: { title: "t", url: "https://techcrunch.com/2024/05/01/ghost-launches-activitypub/" },
      patents: { title: "Publishing system", patent_number: "US1234567B2" },
    }, sources, "Ghost")).not.toThrow();
  });
});

describe("news dates must come from the source (Glamsquad: a 2014 press release dated 2011 by the model)", () => {
  it("accepts the same day written in the text, abbreviated month, or a /YYYY/MM/ URL", () => {
    expect(newsDateIsGrounded("2024-10-15", { url: "https://x.com/a", content: "PARIS, Oct. 15, 2024 /PRNewswire/ -- Gladia" })).toBe(true);
    expect(newsDateIsGrounded("2024-05-01", { url: "https://techcrunch.com/2024/05/01/x/", content: "" })).toBe(true);
    expect(newsDateIsGrounded("2024-05-20", { url: "https://techcrunch.com/2024/05/x/", content: "" })).toBe(true);
  });
  it("accepts a relative 'N days ago' within tolerance", () => {
    expect(newsDateIsGrounded("2026-10-02", { url: "https://x.com/a", content: "Date: 3 days ago" }, "2026-10-05")).toBe(true);
    expect(newsDateIsGrounded("2026-06-01", { url: "https://x.com/a", content: "Date: 3 days ago" }, "2026-10-05")).toBe(false);
  });
  it("drops an unsupported date but keeps the article", () => {
    const { result, dropped } = processMarketExtractionResponse({
      competitors: [],
      news: [{ title: "Ghost launches ActivityPub support", url: "https://techcrunch.com/2024/05/01/ghost-launches-activitypub/", published_date: "2011-05-05" }],
    }, sources, "Ghost");
    expect(result.news).toHaveLength(1);
    expect(result.news[0].published_date).toBeUndefined();
    expect(dropped).toContainEqual({ field: "news.published_date", reason: "news_date_not_in_source" });
  });
});

describe("a company it acquired is never also listed as a competitor", () => {
  it("drops the competitor, keeps the acquisition", () => {
    const { result, dropped } = processMarketExtractionResponse({
      competitors: [
        { name: "Substack", how_it_competes: "x", source_ids: ["S2"], source_id: "S2", evidence_quote: "Ghost competes with Substack and Beehiiv for paid newsletters" },
        { name: "Beehiiv", how_it_competes: "y", source_ids: ["S2"], source_id: "S2", evidence_quote: "Ghost competes with Substack and Beehiiv for paid newsletters" },
      ],
      acquisitions: [{ company_name: "Beehiiv", source_ids: ["S1"] }],
      news: [],
    }, sources, "Ghost");
    expect(result.competitors.map((c) => c.name)).toEqual(["Substack"]);
    expect(result.acquisitions).toHaveLength(1);
    expect(dropped).toContainEqual({ field: "competitors", reason: "competitor_is_acquisition" });
  });
});
