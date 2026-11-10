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
    // Owner, 2026-11-03: siliconvalleyinvestclub.com is now denied explicitly (a company database).
    expect(roundSourceStanding("https://siliconvalleyinvestclub.com/companies/mercury/")).toMatchObject({ kind: "denied" });
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
      { url: "https://devops.com/mercury-raises-100m", title: "Mercury", content: "Mercury raised $100 million led by Natixis.", provider: "serper", query_label: "funding" },
      { url: "https://www.cnbc.com/2026/05/20/mercury.html", title: "Mercury raises $200M", content: "Mercury raised $200 million in a Series D.", provider: "serper", query_label: "funding" },
    ]);
    expect(rejectRound({ round_type: "Other", amount_raised: { value: 100_000_000, source_id: "S1", evidence_quote: "Mercury raised $100 million" } }, "Mercury", sources)).toBe("round_source_not_listed");
    expect(rejectRound({ round_type: "Series D", amount_raised: { value: 200_000_000, source_id: "S2", evidence_quote: "Mercury raised $200 million" } }, "Mercury", sources)).toBeNull();
  });
});

import { rejectRound as rejectRoundForAmount } from "./assemble";
import { buildLabeledSources as labelled } from "./sources";
describe("the amount's own source must be an allowed one (owner, 2026-11-08: Apex, forgeglobal.com)", () => {
  const sources = labelled([
    { url: "https://www.forgeglobal.com/apex_ipo/", title: "Apex", content: "Apex raised a $185.1M Series E.", provider: "serper", query_label: "history" },
    { url: "https://techcrunch.com/2026/06/05/apex-raises-200m/", title: "Apex raises $200M", content: "Glade Brook Capital Partners led the round.", provider: "serper", query_label: "history" },
  ]);
  const [forge, tc] = sources.map((s) => s.source_id);
  const round = (amountSource: string) => ({
    round_type: "Series E", amount_raised: { value: 185_100_000, source_id: amountSource, evidence_quote: "$185.1M Series E" },
    lead_investor: { value: "Glade Brook Capital Partners", source_id: tc, evidence_quote: "Glade Brook Capital Partners led the round." },
    source_url: "https://techcrunch.com/2026/06/05/apex-raises-200m/",
  });
  it("an amount that stands only on an unlisted site is not written, though the lead investor's source is allowed", () => {
    // forgeglobal.com is a data platform since 2026-11-10 (review 9): refused as such, no longer "not listed".
    expect(rejectRoundForAmount(round(forge), "Apex", sources)).toBe("round_only_from_data_platform");
  });
  it("the same round with the amount on the allowed source is not refused for its source", () => {
    expect(rejectRoundForAmount(round(tc), "Apex", sources)).toBeNull();
  });
});

import { corroboratedInvestors } from "./roundSources";
describe("an investor's site is a source only when an allowed source elsewhere names the investor (Orq, 2026-11-09)", () => {
  const gec = { url: "https://goldeneggcheck.com/en/orq-ai-closes-e5m-in-seed-funding/", title: "Orq.ai Closes €5M Seed Funding Led by seed + speed Ventures", content: "Golden Egg Check is among the investors in Orq.ai's seed round." };
  const euStartups = { url: "https://www.eu-startups.com/2025/12/orq-ai-seed/", title: "Amsterdam-based Orq.ai raises €5 million seed", content: "The round was led by seed + speed Ventures and Galion.exe, with participation from Golden Egg Check." };
  const crunchbase = { url: "https://www.crunchbase.com/organization/orq-ai", title: "Orq.ai - Crunchbase", content: "Investors: Golden Egg Check." };
  it("named only by its own site: not corroborated, so its site is not allowed as a source", () => {
    const inv = corroboratedInvestors(["Golden Egg Check"], [gec], "Orq");
    expect(inv).toEqual([]);
    expect(roundSourceStanding(gec.url, { investors: inv, headline: gec.title, companyName: "Orq" }).kind).toBe("unlisted");
  });
  it("named by a data platform as well: still not corroborated", () => {
    expect(corroboratedInvestors(["Golden Egg Check"], [gec, crunchbase], "Orq")).toEqual([]);
  });
  it("named by an allowed outlet as well: corroborated, and its site is allowed", () => {
    const inv = corroboratedInvestors(["Golden Egg Check", "seed + speed Ventures"], [gec, euStartups], "Orq");
    expect(inv).toContain("Golden Egg Check");
    expect(roundSourceStanding(gec.url, { investors: inv, headline: gec.title, companyName: "Orq" })).toMatchObject({ kind: "allowed", why: "investor_site" });
  });
});
