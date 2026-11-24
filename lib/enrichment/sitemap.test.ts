import { describe, it, expect } from "vitest";
import { parseSitemap, robotsSitemaps, pageScore, pickSitePages } from "./sitemap";

describe("pages of a site from its sitemap (owner, round 10)", () => {
  it("reads a urlset, an index and robots.txt", () => {
    expect(parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://a.com/about</loc></url><url><loc><![CDATA[https://a.com/team]]></loc></url></urlset>`)).toEqual({ kind: "urlset", urls: ["https://a.com/about", "https://a.com/team"] });
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>`).kind).toBe("index");
    expect(robotsSitemaps("User-agent: *\nDisallow: /x\nSitemap: https://a.com/sitemap.xml\n")).toEqual(["https://a.com/sitemap.xml"]);
  });
  it("scores the paths that say about / team / contact / press … in English and in the site's language", () => {
    for (const p of ["/about", "/team", "/leadership", "/company", "/contact", "/press", "/news", "/story", "/impressum", "/legal"]) expect(pageScore(p)).toBeGreaterThan(0);
    // not wanted since 2026-11-23: jobs, privacy, terms, investors, history, product pages
    for (const p of ["/careers", "/jobs", "/privacy", "/terms", "/investors", "/history", "/customers", "/industries", "/products/widget-x", "/solutions/retail"]) expect(pageScore(p)).toBe(0);
    for (const p of ["/products", "/solutions", "/platform"]) expect(pageScore(p)).toBeGreaterThan(0);   // the one main product page (2026-11-24)
    for (const p of ["/o-nas", "/sobre", "/quienes-somos", "/ueber-uns", "/a-propos", "/kontakt"]) expect(pageScore(p)).toBeGreaterThan(0);
    expect(pageScore("/pricing")).toBe(0);
    expect(pageScore("/blog/how-we-raised-our-series-a")).toBe(0);
  });
  it("picks at most 12 same-site pages, the best first, files and other sites out", () => {
    const urls = ["https://a.com/", "https://a.com/about", "https://a.com/about/team", "https://a.com/contact", "https://a.com/logo.png", "https://other.com/about", "https://a.com/pricing", "https://a.com/impressum", "https://a.com/blog/post-1"];
    const picked = pickSitePages(urls, "https://a.com");
    expect(picked).toContain("https://a.com/about");
    expect(picked).toContain("https://a.com/impressum");
    expect(picked.some((u) => u.includes("other.com") || u.endsWith(".png") || u.includes("pricing"))).toBe(false);
    const many = Array.from({ length: 80 }, (_, i) => `https://a.com/team/member-${i}`);
    expect(pickSitePages(many, "https://a.com").length).toBeLessThanOrEqual(11);
  });
  it("one legal page besides the impressum (owner, 2026-11-23)", () => {
    const urls = ["https://a.com/impressum", "https://a.com/legal", "https://a.com/legal-notice", "https://a.com/imprint", "https://a.com/about"];
    const picked = pickSitePages(urls, "https://a.com");
    expect(picked.filter((u) => /impressum|legal|imprint/.test(u)).length).toBe(2);
    expect(picked).toContain("https://a.com/about");
  });
  it("one product page: products before solutions before platform, none of the customers or industries pages (owner, 2026-11-24)", () => {
    const urls = ["https://a.com/platform", "https://a.com/solutions", "https://a.com/products", "https://a.com/customers", "https://a.com/industries", "https://a.com/about"];
    const picked = pickSitePages(urls, "https://a.com");
    expect(picked.filter((u) => /\/(products|solutions|platform)$/.test(u))).toEqual(["https://a.com/products"]);
    expect(picked.some((u) => /customers|industries/.test(u))).toBe(false);
    expect(picked).toContain("https://a.com/about");
    expect(pickSitePages(["https://a.com/platform", "https://a.com/solutions"], "https://a.com")).toEqual(["https://a.com/solutions"]);
  });
  it("a press page about a raise is a page of the company, at most three (owner, 2026-11-24: Kry's $300M)", () => {
    expect(pageScore("/press/nyheter/kry-secures-over-300-million-investment")).toBe(9);
    expect(pageScore("/newsroom/2024/acme-raises-series-b")).toBe(9);
    expect(pageScore("/blog/how-we-raised-our-series-a")).toBe(0);                          // a blog post still is not
    expect(pageScore("/press/nyheter/kry-acquires-physical-health-care-centres")).toBe(7);   // a general press page keeps its score
    const urls = [1, 2, 3, 4, 5].map((i) => `https://a.com/press/news/acme-raises-round-${i}`).concat(["https://a.com/about", "https://a.com/contact"]);
    const picked = pickSitePages(urls, "https://a.com");
    expect(picked.filter((u) => /raises-round/.test(u)).length).toBe(3);
    expect(picked).toContain("https://a.com/about");
  });
});
