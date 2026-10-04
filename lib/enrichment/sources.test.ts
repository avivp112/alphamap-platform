import { describe, it, expect } from "vitest";
import { classifySourceType, buildLabeledSources, formatSourcesForPrompt, aggregatorOnlyShare, type RawSearchResult } from "./sources";

describe("classifySourceType", () => {
  it("recognizes the company's own verified domain as company_site", () => {
    expect(classifySourceType("https://www.apexspace.com/news/raise", "apexspace.com")).toBe("company_site");
    expect(classifySourceType("https://apexspace.com/about", "apexspace.com")).toBe("company_site");
  });
  it("recognizes registry domains (SEC EDGAR, Companies House)", () => {
    expect(classifySourceType("https://www.sec.gov/cgi-bin/browse-edgar")).toBe("registry");
    expect(classifySourceType("https://find-and-update.company-information.service.gov.uk/company/123")).toBe("registry");
  });
  it("recognizes the issue 15 aggregator list", () => {
    expect(classifySourceType("https://www.crunchbase.com/organization/fresha")).toBe("aggregator_snippet");
    expect(classifySourceType("https://pitchbook.com/profiles/company/168166-45")).toBe("aggregator_snippet");
    expect(classifySourceType("https://www.linkedin.com/company/apex-space")).toBe("aggregator_snippet");
  });
  it("recognizes press release wires", () => {
    expect(classifySourceType("https://www.businesswire.com/news/home/x")).toBe("press_release");
    expect(classifySourceType("https://www.prnewswire.com/news-releases/x")).toBe("press_release");
  });
  it("falls back to news for a direct-reporting outlet not otherwise classified", () => {
    expect(classifySourceType("https://techcrunch.com/2023/06/22/apex-space")).toBe("news");
    expect(classifySourceType("https://payloadspace.com/apex-raises-200m")).toBe("news");
  });
  it("does not misclassify an unrelated domain as company_site just because no domain was given", () => {
    expect(classifySourceType("https://techcrunch.com/x")).toBe("news");
  });
});

describe("buildLabeledSources", () => {
  const raw: RawSearchResult[] = [
    { url: "https://techcrunch.com/a", content: "search result 1", provider: "serper", query_label: "history" },
    { url: "https://www.apexspace.com/", content: "homepage text", provider: "jina", query_label: "website" },
    { url: "https://spacenews.com/b", content: "search result 2", provider: "tavily", query_label: "amounts" },
    { url: "https://www.apexspace.com/about", content: "about page text", provider: "jina", query_label: "website" },
  ];

  it("assigns S-ids to search results and W-ids to website pages, in input order", () => {
    const labeled = buildLabeledSources(raw, "apexspace.com");
    expect(labeled.map((s) => s.source_id)).toEqual(["S1", "W1", "S2", "W2"]);
  });

  it("classifies each source's type using the given company domain", () => {
    const labeled = buildLabeledSources(raw, "apexspace.com");
    expect(labeled.find((s) => s.source_id === "W1")?.source_type).toBe("company_site");
    expect(labeled.find((s) => s.source_id === "S1")?.source_type).toBe("news");
  });
});

describe("formatSourcesForPrompt", () => {
  it("renders the [S3] url / content block format", () => {
    const labeled = buildLabeledSources(
      [{ url: "https://techcrunch.com/a", title: "Apex raises $16M", content: "Apex closed a Series A.", provider: "serper", query_label: "history" }],
      null,
    );
    const rendered = formatSourcesForPrompt(labeled);
    expect(rendered).toContain("[S1] https://techcrunch.com/a");
    expect(rendered).toContain("Apex raises $16M");
    expect(rendered).toContain("Apex closed a Series A.");
  });
});

describe("aggregatorOnlyShare", () => {
  it("computes the share of cited sources that are aggregator_snippet", () => {
    const labeled = buildLabeledSources(
      [
        { url: "https://www.crunchbase.com/organization/x", content: "", provider: "serper", query_label: "backers" },
        { url: "https://techcrunch.com/x", content: "", provider: "serper", query_label: "history" },
      ],
      null,
    );
    expect(aggregatorOnlyShare(["S1", "S2"], labeled)).toBe(0.5);
    expect(aggregatorOnlyShare(["S2"], labeled)).toBe(0);
    expect(aggregatorOnlyShare([], labeled)).toBe(0);
  });
});
