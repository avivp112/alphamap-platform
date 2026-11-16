import { describe, it, expect } from "vitest";
import { maxArticles, DEFAULT_MAX_ARTICLES } from "./articleBudget";

describe("MAX_ARTICLES (owner, 2026-11-07)", () => {
  it("defaults to eight (owner, round 10)", () => { expect(maxArticles({})).toBe(8); expect(DEFAULT_MAX_ARTICLES).toBe(8); });
  it("is set by MAX_ARTICLES, or by the older ARTICLES_TO_READ", () => {
    expect(maxArticles({ MAX_ARTICLES: "8" })).toBe(8);
    expect(maxArticles({ ARTICLES_TO_READ: "3" })).toBe(3);
    expect(maxArticles({ MAX_ARTICLES: "5", ARTICLES_TO_READ: "3" })).toBe(5);
  });
  it("0 turns article reading off, and nonsense falls back to the default", () => {
    expect(maxArticles({ MAX_ARTICLES: "0" })).toBe(0);
    expect(maxArticles({ MAX_ARTICLES: "abc" })).toBe(8);
    expect(maxArticles({ MAX_ARTICLES: "-2" })).toBe(8);
  });
});
