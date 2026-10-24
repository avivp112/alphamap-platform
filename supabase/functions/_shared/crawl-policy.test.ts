import { describe, it, expect, vi } from "vitest";
import { parseRobots, robotsAllows, RobotsGate, crawlerUserAgent, CRAWLER } from "./crawl-policy";

describe("robots.txt", () => {
  // comeet.com's, as the owner read it on 2026-10-23 (abridged)
  const comeet = `User-agent: Scrapy
Allow: /

User-agent: *
Disallow: *?s=*
Disallow: */category/*
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Sitemap: https://www.comeet.com/resources/post-sitemap.xml`;

  it("reads the * group when none names us", () => {
    const rules = parseRobots(comeet);
    expect(robotsAllows(rules, "/jobs/sett/4A.00B")).toBe(true);
    expect(robotsAllows(rules, "/wp-admin/x")).toBe(false);
    expect(robotsAllows(rules, "/wp-admin/admin-ajax.php")).toBe(true);   // the longer rule wins
    expect(robotsAllows(rules, "/blog?s=jobs")).toBe(false);
  });
  it("a group naming us takes precedence over *", () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: AlphaMapBot\nDisallow: /private/`);
    expect(robotsAllows(rules, "/jobs")).toBe(true);
    expect(robotsAllows(rules, "/private/x")).toBe(false);
  });
  it("Disallow: / blocks everything; an empty Disallow blocks nothing", () => {
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /"), "/careers-api/2.0/company/4A.00B/positions")).toBe(false);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow:"), "/anything")).toBe(true);
    expect(robotsAllows(parseRobots(""), "/anything")).toBe(true);
  });
  it("several agents share one group; $ anchors the end; comments are ignored", () => {
    const rules = parseRobots(`User-agent: Googlebot\nUser-agent: *  # everyone\nDisallow: /*.xml$\nDisallow: /tmp # temp`);
    expect(robotsAllows(rules, "/xml")).toBe(true);
    expect(robotsAllows(rules, "/feed.xml")).toBe(false);
    expect(robotsAllows(rules, "/feed.xml?x=1")).toBe(true);
    expect(robotsAllows(rules, "/tmp/a")).toBe(false);
  });
});

describe("RobotsGate", () => {
  const res = (status: number, body = "") => new Response(body, { status });
  it("reads robots.txt once per site, with our User-Agent", async () => {
    const f = vi.fn(async () => res(200, "User-agent: *\nDisallow: /private"));
    const gate = new RobotsGate(f);
    expect(await gate.check("https://acme.com/careers")).toBe("allowed");
    expect(await gate.check("https://acme.com/private/x")).toBe("disallowed");
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe("https://acme.com/robots.txt");
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers["User-Agent"]).toBe(crawlerUserAgent());
  });
  it("no robots.txt (404) allows; one that cannot be read (5xx, error) is unknown — never a guess", async () => {
    expect(await new RobotsGate(async () => res(404)).check("https://a.com/x")).toBe("allowed");
    expect(await new RobotsGate(async () => res(503)).check("https://a.com/x")).toBe("unknown");
    expect(await new RobotsGate(async () => { throw new Error("dns"); }).check("https://a.com/x")).toBe("unknown");
  });
  it("only web URLs", async () => {
    expect(await new RobotsGate(async () => res(404)).check("javascript:alert(1)")).toBe("disallowed");
  });
});

describe("the User-Agent", () => {
  it("names the product, and its site only when a real https address is set", () => {
    expect(crawlerUserAgent()).toBe(CRAWLER.infoUrl ? `AlphaMapBot/1.0 (+${CRAWLER.infoUrl})` : "AlphaMapBot/1.0");
    expect(crawlerUserAgent()).not.toMatch(/__|example|alphamap\.(app|io)/);
  });
});
