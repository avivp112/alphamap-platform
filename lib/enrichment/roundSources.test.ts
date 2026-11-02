import { describe, it, expect } from "vitest";
import { roundSourceStanding, isInvestorSite, reviewDomain, roundSourceConfidence } from "./roundSources";
import { rejectRound } from "./assemble";
import { buildLabeledSources } from "./sources";

describe("a round is written only from an allowed source (owner, 2026-11-01: the review sheet came from multiples.vc, fundediq.co, parsers.vc, Wikipedia, a spam domain)", () => {
  it("the sheet's sources are denied or unlisted", () => {
    for (const u of ["https://multiples.vc/private-comps/fresha", "https://fundediq.co/aidoc-aidoc-com-funding/", "https://parsers.vc/startup/wayve.ai/",
      "https://startup-map.cologne/companies/cyera", "https://en.wikipedia.org/wiki/Cato_Networks", "https://tracxn.com/d/companies/celonis"]) {
      expect(roundSourceStanding(u).kind).toBe("denied");
    }
    expect(roundSourceStanding("https://turboanglerstack3.lol/2026/10/29/hailo-ai-funding")).toEqual({ kind: "unlisted", domain: "turboanglerstack3.lol" });
    expect(roundSourceStanding("https://siliconvalleyinvestclub.com/companies/mercury/")).toEqual({ kind: "unlisted", domain: "siliconvalleyinvestclub.com" });
  });
  it("tiers, subdomains included; EIN Presswire and tier 4 count with lower confidence", () => {
    expect(roundSourceStanding("https://www.globenewswire.com/news-release/2026/06/03/x.html")).toMatchObject({ kind: "allowed", tier: 1, lowConfidence: false });
    expect(roundSourceStanding("https://www.einpresswire.com/article/1")).toMatchObject({ kind: "allowed", tier: 1, lowConfidence: true });
    // newswire.com and Accesswire: the company's own release, below its site (owner, 2026-11-02 — Koi's founders).
    expect(roundSourceStanding("https://www.newswire.com/news/koi-raises-48m-22637208")).toMatchObject({ kind: "allowed", tier: 1, lowConfidence: true });
    expect(roundSourceStanding("https://www.accesswire.com/1/x")).toMatchObject({ kind: "allowed", tier: 1, lowConfidence: true });
    expect(roundSourceStanding("https://www.prnewswire.com/news-releases/x.html")).toMatchObject({ kind: "allowed", tier: 1, lowConfidence: false });
    expect(roundSourceStanding("https://www.cnbc.com/2026/05/20/x.html")).toMatchObject({ kind: "allowed", tier: 2 });
    expect(roundSourceStanding("https://en.globes.co.il/en/article-x")).toMatchObject({ kind: "allowed", tier: 3 });
    expect(roundSourceStanding("https://www.calcalistech.com/ctechnews/article/x")).toMatchObject({ kind: "allowed", tier: 3 });
    expect(roundSourceStanding("https://www.fiercebiotech.com/x")).toMatchObject({ kind: "allowed", tier: 4, lowConfidence: true });
    expect(roundSourceStanding("https://devops.com/coralogix-raises-25m")).toMatchObject({ kind: "unlisted", domain: "devops.com" });
    expect(roundSourceConfidence(90, roundSourceStanding("https://www.fiercebiotech.com/x"))).toBe(60);
  });
  it("the company's own site and the lead investor's own site are first-hand", () => {
    expect(roundSourceStanding("https://www.cyera.com/blog/x", { isCompanySite: true })).toMatchObject({ kind: "allowed", tier: 1, why: "company_site" });
    expect(isInvestorSite("https://www.indexventures.com/perspectives/x", "Index Ventures")).toBe(true);
    expect(isInvestorSite("https://fiveelms.com/news/darkowl", "Five Elms Capital")).toBe(true);
    expect(isInvestorSite("https://www.accel.com/noteworthy/x", "Accel")).toBe(true);
    expect(isInvestorSite("https://www.generalcatalyst.com/stories/x", "General Catalyst")).toBe(true);
    expect(isInvestorSite("https://devops.com/x", "Red Dot Capital Partners")).toBe(false);
  });
  it("the domain to review is the registrable one", () => {
    expect(reviewDomain("https://news.example.co.uk/a")).toBe("example.co.uk");
    expect(reviewDomain("https://blog.acme.com/a")).toBe("acme.com");
  });
  it("a round only unlisted sources state is not written — kept as a hint", () => {
    const sources = buildLabeledSources([
      { url: "https://siliconvalleyinvestclub.com/companies/mercury/", title: "Mercury", content: "Mercury raised $100 million led by Natixis.", provider: "serper", query_label: "funding" },
      { url: "https://www.cnbc.com/2026/05/20/mercury.html", title: "Mercury raises $200M", content: "Mercury raised $200 million in a Series D.", provider: "serper", query_label: "funding" },
    ]);
    expect(rejectRound({ round_type: "Other", amount_raised: { value: 100_000_000, source_id: "S1", evidence_quote: "Mercury raised $100 million" } }, "Mercury", sources)).toBe("round_source_not_listed");
    expect(rejectRound({ round_type: "Series D", amount_raised: { value: 200_000_000, source_id: "S2", evidence_quote: "Mercury raised $200 million" } }, "Mercury", sources)).toBeNull();
  });
});
