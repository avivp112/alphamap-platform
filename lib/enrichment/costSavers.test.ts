import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SearchCache } from "./searchCache";
import { pickArticlesToRead, cleanArticleText } from "./articles";
import { shouldSkipAsNonTech, buildTechGateRequest } from "./techGate";
import { isNearDuplicatePage } from "./searchProviders";
import type { RawSearchResult } from "./sources";

describe("SearchCache — re-runs reuse what was already fetched", () => {
  it("persists across instances, counts hits, never stores empty results", () => {
    const file = join(mkdtempSync(join(tmpdir(), "sc-")), "c.json");
    const a = new SearchCache(file, 30);
    a.set("serper:q", [{ url: "u" }]);
    a.set("serper:empty", []);
    a.save();
    expect(existsSync(file)).toBe(true);
    const b = new SearchCache(file, 30);
    expect(b.get("serper:q")).toEqual([{ url: "u" }]);
    expect(b.get("serper:empty")).toBeUndefined();
    expect(b.hits).toBe(1);
  });
  it("expires entries older than the configured lifetime", () => {
    const file = join(mkdtempSync(join(tmpdir(), "sc-")), "c.json");
    let now = Date.parse("2026-01-01");
    const a = new SearchCache(file, 30, () => now);
    a.set("k", "v"); a.save();
    now = Date.parse("2026-03-01");
    expect(new SearchCache(file, 30, () => now).get("k")).toBeUndefined();
  });
});

describe("pickArticlesToRead — full text only where it pays off", () => {
  const r = (url: string, title: string, content: string, query_label = "overview", provider: RawSearchResult["provider"] = "serper"): RawSearchResult => ({ url, title, content, query_label, provider });
  const results = [
    r("https://www.crunchbase.com/organization/gladia", "Gladia - Crunchbase", "Gladia raised $16M Series A", "funding"),
    r("https://gladia.io/blog/series-a", "Our Series A", "Gladia raised", "funding"),
    r("https://techcrunch.com/2024/10/15/gladia", "Gladia raises $16M", "Gladia raised a $16 million Series A led by XAnge", "funding"),
    r("https://blog.example.com/speech", "Top speech APIs", "Deepgram and AssemblyAI lead the market", "competitors"),
    r("https://slator.com/gladia-16m", "Gladia Raises USD 16M", "Source: Slator — Date: Oct 15, 2024 — Gladia raises", "news"),
    r("https://example.org/gladia-review", "Gladia review", "Gladia is an API for transcription", "overview"),
    r("https://gladia.io", "Gladia", "home", "website", "jina"),
  ];
  it("prefers third-party funding news naming the company; skips directories, the company's own site, and articles not about it", () => {
    const urls = pickArticlesToRead(results, "Gladia", "gladia.io", 3).map((x) => x.url);
    expect(urls).toEqual(["https://slator.com/gladia-16m", "https://techcrunch.com/2024/10/15/gladia", "https://example.org/gladia-review"]);
  });
  it("cleans Jina markdown: no images, link targets dropped, published time kept", () => {
    const text = cleanArticleText("Title: X\nURL Source: https://a\nPublished Time: 2024-10-15\n\n![img](https://i.png)\nGladia [raised](https://l) $16M.\n\n\nMore.");
    expect(text).toContain("Published Time: 2024-10-15");
    expect(text).toContain("Gladia raised $16M.");
    expect(text).not.toContain("i.png");
    expect(text).not.toContain("URL Source");
  });
});

describe("tech pre-check — one-sided", () => {
  it("skips only a high-confidence non-tech verdict", () => {
    expect(shouldSkipAsNonTech({ is_tech_company: false, confidence: "high", reason: "beverage brand" })).toBe(true);
    expect(shouldSkipAsNonTech({ is_tech_company: false, confidence: "medium", reason: "" })).toBe(false);
    expect(shouldSkipAsNonTech({ is_tech_company: true, confidence: "high", reason: "" })).toBe(false);
    expect(shouldSkipAsNonTech(null)).toBe(false);
  });
  it("counts app/platform businesses as tech in its own instructions", () => {
    const req = buildTechGateRequest("Glamsquad", "Book beauty pros in our app", null, null);
    expect(req.messages[0].content).toContain("runs its own app, software platform, marketplace");
  });
});

describe("isNearDuplicatePage", () => {
  const page = "Gladly is the people-centered customer service platform trusted by the world's most loved brands including Tory Burch UGG and Nordstrom for every conversation.";
  it("treats the same page with a different nav line as a duplicate, different pages as distinct", () => {
    expect(isNearDuplicatePage(page, page + " Careers")).toBe(true);
    expect(isNearDuplicatePage(page, "Contact us: 123 Main Street, San Francisco, CA. Call our sales team or email support for help today.")).toBe(false);
  });
});

describe("serperSearch with a cache — a repeated query costs nothing, even in a later run", () => {
  it("calls the API once, then serves the same query from the cache file", async () => {
    const { vi } = await import("vitest");
    const { serperSearch, createSearchProviderState } = await import("./searchProviders");
    const file = join(mkdtempSync(join(tmpdir(), "sc-")), "c.json");
    process.env.SERP_KEY = "test";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ organic: [{ link: "https://a.com/x", title: "Gladia", snippet: "Gladia raised" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const run1 = createSearchProviderState();
      run1.cache = new SearchCache(file, 30);
      expect(await serperSearch('"Gladia" funding', "funding", run1)).toHaveLength(1);
      expect(await serperSearch('"Gladia" funding', "funding_again", run1)).toEqual([expect.objectContaining({ url: "https://a.com/x", query_label: "funding_again" })]);
      run1.cache.save();
      const run2 = createSearchProviderState();
      run2.cache = new SearchCache(file, 30);
      await serperSearch('"Gladia" funding', "funding", run2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(run2.serperCallCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
