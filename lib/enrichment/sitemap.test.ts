import { describe, it, expect } from "vitest";
import { parseSitemap, robotsSitemaps, pageScore, pickSitePages } from "./sitemap";

describe("pages of a site from its sitemap (owner, round 10)", () => {
  it("reads a urlset, an index and robots.txt", () => {
    expect(parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://a.com/about</loc></url><url><loc><![CDATA[https://a.com/team]]></loc></url></urlset>`)).toEqual({ kind: "urlset", urls: ["https://a.com/about", "https://a.com/team"] });
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>`).kind).toBe("index");
    expect(robotsSitemaps("User-agent: *\nDisallow: /x\nSitemap: https://a.com/sitemap.xml\n")).toEqual(["https://a.com/sitemap.xml"]);
  });
  it("scores the paths that say about / team / contact / press … in English and in the site's language", () => {
    for (const p of ["/about", "/team", "/leadership", "/company", "/contact", "/press", "/news", "/careers", "/jobs", "/story", "/history", "/impressum", "/legal", "/investors"]) expect(pageScore(p)).toBeGreaterThan(0);
    for (const p of ["/o-nas", "/sobre", "/quienes-somos", "/ueber-uns", "/a-propos", "/kontakt"]) expect(pageScore(p)).toBeGreaterThan(0);
    expect(pageScore("/pricing")).toBe(0);
    expect(pageScore("/blog/how-we-raised-our-series-a")).toBe(0);
  });
  it("picks at most 30 same-site pages, the best first, files and other sites out", () => {
    const urls = ["https://a.com/", "https://a.com/about", "https://a.com/about/team", "https://a.com/contact", "https://a.com/logo.png", "https://other.com/about", "https://a.com/pricing", "https://a.com/impressum", "https://a.com/blog/post-1"];
    const picked = pickSitePages(urls, "https://a.com");
    expect(picked).toContain("https://a.com/about");
    expect(picked).toContain("https://a.com/impressum");
    expect(picked.some((u) => u.includes("other.com") || u.endsWith(".png") || u.includes("pricing"))).toBe(false);
    const many = Array.from({ length: 80 }, (_, i) => `https://a.com/team/member-${i}`);
    expect(pickSitePages(many, "https://a.com").length).toBeLessThanOrEqual(29);
  });
});
