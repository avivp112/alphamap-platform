import { describe, it, expect } from "vitest";
import {
  parseSerperResponse, parseSerperNewsResponse, parseTavilyResponse, looksLikeRealContent,
  needsTavilySupplement, mergeSearchResults, THIN_RESULTS_THRESHOLD,
} from "./searchProviders";
import type { RawSearchResult } from "./sources";

function result(url: string, provider: RawSearchResult["provider"] = "serper"): RawSearchResult {
  return { url, title: "x", content: "y", provider, query_label: "history" };
}

describe("parseSerperResponse", () => {
  it("maps organic results into RawSearchResult[], capped at 8", () => {
    const organic = Array.from({ length: 12 }, (_, i) => ({ title: `Result ${i}`, link: `https://example.com/${i}`, snippet: `snippet ${i}` }));
    const results = parseSerperResponse({ organic }, "history");
    expect(results).toHaveLength(8);
    expect(results[0]).toEqual({ url: "https://example.com/0", title: "Result 0", content: "snippet 0", provider: "serper", query_label: "history" });
  });

  it("drops the answerBox/knowledgeGraph summary -- it has no URL to cite as a source", () => {
    const results = parseSerperResponse(
      { answerBox: { answer: "Apex was founded in 2022." }, organic: [{ title: "x", link: "https://x.com", snippet: "y" }] },
      "profile",
    );
    expect(results).toHaveLength(1);
    expect(results.every((r) => r.content !== "Apex was founded in 2022.")).toBe(true);
  });

  it("returns [] for an empty response", () => {
    expect(parseSerperResponse({}, "history")).toEqual([]);
  });
});

describe("parseSerperNewsResponse -- the dedicated News API v1 always used and v2 never did until a real comparison run surfaced the gap", () => {
  it("maps news items into RawSearchResult[], folding source/date into content, capped at 8", () => {
    const news = [
      { title: "Apex raises $16M Series A", link: "https://techcrunch.com/apex-a", snippet: "Apex closed a $16M round.", date: "2 days ago", source: "TechCrunch", imageUrl: "https://x.com/img.png" },
    ];
    const results = parseSerperNewsResponse({ news }, "news");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: "https://techcrunch.com/apex-a",
      title: "Apex raises $16M Series A",
      content: "Source: TechCrunch — Date: 2 days ago — Apex closed a $16M round.",
      provider: "serper",
      query_label: "news",
    });
  });

  it("returns [] for an empty response", () => {
    expect(parseSerperNewsResponse({}, "news")).toEqual([]);
  });

  it("caps at 8 items", () => {
    const news = Array.from({ length: 12 }, (_, i) => ({ title: `Article ${i}`, link: `https://x.com/${i}` }));
    expect(parseSerperNewsResponse({ news }, "news")).toHaveLength(8);
  });
});

describe("parseTavilyResponse", () => {
  it("maps results into RawSearchResult[]", () => {
    const results = parseTavilyResponse({ results: [{ title: "x", url: "https://x.com", content: "y" }] }, "amounts");
    expect(results).toEqual([{ url: "https://x.com", title: "x", content: "y", provider: "tavily", query_label: "amounts" }]);
  });
  it("returns [] when there are no results", () => {
    expect(parseTavilyResponse({ answer: "something" }, "amounts")).toEqual([]);
  });
});

describe("looksLikeRealContent", () => {
  it("rejects a thin generic 404 page -- the real DRY_RUN=false pattern: completely different companies' /team, /company, /contact guessed paths all came back at 150-250 chars", () => {
    expect(looksLikeRealContent("404 - Page Not Found\n\nSorry, we couldn't find the page you're looking for.")).toBe(false);
    expect(looksLikeRealContent("Oops! This page doesn't exist. Go back home.")).toBe(false);
  });

  it("rejects anything under the minimum length regardless of wording", () => {
    expect(looksLikeRealContent("Coming soon.")).toBe(false);
  });

  it("accepts a real, substantial page", () => {
    const real = "Falanx Cyber is an enterprise-class cybersecurity services company. ".repeat(10);
    expect(looksLikeRealContent(real)).toBe(true);
  });

  it("does not reject a long real page merely because it happens to mention '404' somewhere", () => {
    const real = ("Our platform returns clean error codes like 404 for missing resources, and our team of engineers builds reliable, well-documented APIs for enterprise customers worldwide. ").repeat(5);
    expect(looksLikeRealContent(real)).toBe(true);
  });
});

describe("needsTavilySupplement -- Serper+Tavily collaboration, not a strict fallback", () => {
  it("does not need Tavily once Serper's own coverage meets the threshold", () => {
    const serperResults = Array.from({ length: THIN_RESULTS_THRESHOLD }, (_, i) => result(`https://x.com/${i}`));
    expect(needsTavilySupplement(serperResults)).toBe(false);
  });

  it("needs Tavily when Serper's coverage is below the threshold, including literally empty", () => {
    expect(needsTavilySupplement([])).toBe(true);
    const thin = Array.from({ length: THIN_RESULTS_THRESHOLD - 1 }, (_, i) => result(`https://x.com/${i}`));
    expect(needsTavilySupplement(thin)).toBe(true);
  });
});

describe("mergeSearchResults -- Serper and Tavily combine, not one replacing the other", () => {
  it("keeps Serper's own thin results AND adds Tavily's independent hits", () => {
    const serper = [result("https://techcrunch.com/apex")];
    const tavily = [result("https://sifted.eu/apex", "tavily"), result("https://pitchbook.com/apex", "tavily")];
    const merged = mergeSearchResults(serper, tavily);
    expect(merged).toHaveLength(3);
    expect(merged[0].url).toBe("https://techcrunch.com/apex");
  });

  it("never double-counts the same URL reported by both providers", () => {
    const serper = [result("https://techcrunch.com/apex")];
    const tavily = [result("https://techcrunch.com/apex", "tavily"), result("https://sifted.eu/apex", "tavily")];
    const merged = mergeSearchResults(serper, tavily);
    expect(merged).toHaveLength(2);
    expect(merged.filter((r) => r.url === "https://techcrunch.com/apex")).toHaveLength(1);
  });

  it("returns Serper's results unchanged when Tavily found nothing new", () => {
    const serper = [result("https://techcrunch.com/apex")];
    expect(mergeSearchResults(serper, [])).toEqual(serper);
  });
});
