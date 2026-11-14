import { describe, it, expect, beforeEach } from "vitest";
import { brandLabelMatches, pageNamesCompany, ownBrandSources } from "./ownDomain.ts";
import { roundSourceStanding, profileSourceAllowed, isPartyRelease } from "./roundSources.ts";
import { domainClasses, parseDomainClass, isHedged } from "./domainClass.ts";
import { describeAttempt } from "./descriptionBuilder.ts";

beforeEach(() => domainClasses.clear());

describe("round 6 (owner, 2026-11-14): the company's own site on another domain is tier 1", () => {
  it("the same brand: aerobotix.com for Aerobotix, moft.com for Moft", () => {
    expect(brandLabelMatches("https://aerobotix.com/", "Aerobotix")).toBe(true);
    expect(brandLabelMatches("https://www.moft.com/pages/company-info", "Moft")).toBe(true);
    expect(brandLabelMatches("https://moft.us/", "Moft")).toBe(true);
    expect(brandLabelMatches("https://motorway.co.uk/", "Moft")).toBe(false);
    expect(brandLabelMatches("https://aerobotix.com/", "Aerobotix, Inc.")).toBe(true);
  });
  it("and the page names the company", () => {
    expect(pageNamesCompany({ title: "Company Info", content: "MOFT is based in Spokane" }, "Moft")).toBe(true);
    expect(pageNamesCompany({ title: "Welcome", content: "Hardware for kitchens" }, "Moft")).toBe(false);
  });
  it("marks the page as the company's own, so it is tier 1 and never blocked (even when the domain was classified company_owned)", () => {
    domainClasses.set({ key: "moft.com", class: "company_owned", reason: "", example_url: "", example_title: "", at: "" });
    const src = { url: "https://www.moft.com/pages/company-info", title: "Company Info", content: "MOFT, Spokane, WA", source_type: "news" };
    expect(roundSourceStanding(src.url).kind).toBe("denied");              // the class, without the company's context
    const own = ownBrandSources([src, { url: "https://other.com/x", title: "t", content: "Moft is mentioned", source_type: "news" }], "Moft", null);
    expect(own.map((x) => x.url)).toEqual([src.url]);
    expect(roundSourceStanding(src.url, { isCompanySite: true })).toMatchObject({ kind: "allowed", tier: 1 });
    expect(profileSourceAllowed({ ...src, source_type: "company_site" }, "Moft")).toBe(true);
  });
  it("the domain the registered website redirects to, with the company named", () => {
    const own = ownBrandSources([{ url: "https://aerobotix.com/about", title: "About Aerobotix Robotics", content: "Aerobotix Robotics is in Huntsville", source_type: "news" }], "Aerobotix Robotics", "aerobotix.com");
    expect(own).toHaveLength(1);
  });
});

describe("a party's own announcement: for the news and the event, not for facts about the company", () => {
  it("Baker Hughes on Hydrostor, General Mills on ALUS, Equifax on DataX are party releases", () => {
    expect(isPartyRelease("https://www.bakerhughes.com/company/news/baker-hughes-and-hydrostor-deepen-strategic-collaboration", "Baker Hughes and Hydrostor Deepen Strategic Collaboration")).toBe(true);
    expect(isPartyRelease("https://www.generalmills.com/news/press-releases/general-mills-invests-2-3-million-with-alus", "General Mills invests $2.3 million to advance regenerative agriculture with ALUS")).toBe(true);
    expect(isPartyRelease("https://investor.equifax.com/news-and-events/news/2018/equifax-acquires-datax", "Equifax Acquires DataX to Expand Credit Access for Consumers")).toBe(true);
    expect(isPartyRelease("https://www.randomsite.com/news/baker-hughes", "Baker Hughes and Hydrostor")).toBe(false);
  });
  it("is tier 1 for the event, but no source for the headquarters, employees or founders", () => {
    const url = "https://www.bakerhughes.com/company/news/baker-hughes-and-hydrostor-deepen-strategic-collaboration";
    expect(roundSourceStanding(url, { headline: "Baker Hughes and Hydrostor Deepen Strategic Collaboration" })).toMatchObject({ kind: "allowed", tier: 1, why: "party_release" });
    expect(profileSourceAllowed({ url, source_type: "news", title: "Baker Hughes and Hydrostor Deepen Strategic Collaboration", content: "" }, "Hydrostor")).toBe(false);
  });
});

describe("domain classes: a guess is blocked, a page's class is the page's", () => {
  it("a hedged reason is no decision", () => {
    expect(isHedged("The domain ossia.com is not a recognizable outlet, so this is a best guess.")).toBe(true);
    expect(isHedged("finance.biggo.com ... though it may be an aggregator rather than an original newsroom")).toBe(true);
    expect(isHedged("Gizmodo is a tech publication with editors.")).toBe(false);
    expect(parseDomainClass({ class: "news_outlet", scope: "domain", confident: true, reason: "A best guess." })).toMatchObject({ class: "blog_vendor_other" });
    expect(parseDomainClass({ class: "news_outlet", scope: "domain", confident: false, reason: "Trade publication." })).toMatchObject({ class: "blog_vendor_other" });
    expect(parseDomainClass({ class: "news_outlet", scope: "domain", confident: true, reason: "Trade publication with editors." })).toMatchObject({ class: "news_outlet" });
  });
  it("a page-scoped class does not classify the site (haaretz.com's Haaretz Labels piece)", () => {
    domainClasses.set({ key: "page:https://www.haaretz.com/labels/x", class: "blog_vendor_other", reason: "sponsored", example_url: "https://www.haaretz.com/labels/x", example_title: "", at: "", page: true });
    expect(domainClasses.get("https://www.haaretz.com/labels/x")).toBeDefined();
    expect(domainClasses.get("https://www.haaretz.com/israel-news/y")).toBeUndefined();
  });
  it("the owner's lists: tier 2, tier 3, blocked, trade press", () => {
    for (const d of ["theaustralian.com.au", "smh.com.au"]) expect(roundSourceStanding(`https://www.${d}/business/x`)).toMatchObject({ kind: "allowed", tier: 2 });
    for (const d of ["haaretz.com", "taipeitimes.com", "gulfnews.com", "khaleejtimes.com"]) expect(roundSourceStanding(`https://www.${d}/news/x`)).toMatchObject({ kind: "allowed", tier: 3 });
    for (const d of ["ossia.com", "biggo.com"]) expect(roundSourceStanding(`https://finance.${d}/news/x`).kind).toBe("denied");
    expect(roundSourceStanding("https://www.robotics247.com/article/x")).toMatchObject({ kind: "allowed", tier: 4 });
  });
});

describe("a description that fails says why (nine companies without one and nothing in the log)", () => {
  const byId = { W1: { content: "Acme is a platform." } };
  it("returns every dropped sentence even when there is no description", () => {
    const r = describeAttempt({ sentences: [
      { role: "what", text: "Acme is a revolutionary platform for everyone.", source_ids: ["W1"] },
      { role: "for_whom", text: "Acme serves 300 customers in the manufacturing and retail fields.", source_ids: ["W1"] },
    ] }, "Acme", byId, () => true);
    expect(r.built).toBeNull();
    expect(r.dropped.map((d) => d.why)).toEqual(["marketing_word", expect.stringMatching(/^number_not_in_sources/)]);
    expect(r.returned.map((x) => x.role)).toEqual(["what", "for_whom"]);
  });
});
