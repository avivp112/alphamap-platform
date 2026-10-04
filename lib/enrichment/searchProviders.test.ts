import { describe, it, expect } from "vitest";
import { parseSerperResponse, parseTavilyResponse, looksLikeRealContent } from "./searchProviders";

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
