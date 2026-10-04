import { describe, it, expect } from "vitest";
import { parseSerperResponse, parseTavilyResponse } from "./searchProviders";

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
