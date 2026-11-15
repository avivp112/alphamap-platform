import { describe, it, expect, beforeEach } from "vitest";
import { mentionsAddress, brandLabelMatches, pageNamesCompany, ownBrandSources, ownEvidence, emailsIn, phonesIn, addressesIn, productTerms } from "./ownDomain.ts";
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
    const registered = { host: "moft.us", pages: [{ url: "https://moft.us/", content: "MOFT stands. Contact: support@moft.us Language: [moft.com](https://www.moft.com)" }] };
    const own = ownBrandSources([src, { url: "https://other.com/x", title: "t", content: "Moft is mentioned", source_type: "news" }], "Moft", null, registered);
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


describe("condition on MR 54: the same brand is not enough — marvel.com is not Marvel App's, datax.com is not DataX's", () => {
  const marvelRegistered = { host: "marvelapp.com", pages: [{ url: "https://marvelapp.com/", title: "Marvel — design and prototyping", content: "# Prototyping\nMarvel is a design platform. Contact hello@marvelapp.com. 20 Bartholomew Street, London" }] };
  const marvelComics = { url: "https://www.marvel.com/", title: "Marvel Entertainment", content: "Marvel Comics, movies and characters. Disney+" };
  it("marvel.com (comics) has no link, contact or product with marvelapp.com: not Marvel App's", () => {
    expect(ownEvidence(marvelComics, marvelRegistered, "Marvel")).toBeNull();
    expect(ownBrandSources([{ ...marvelComics, source_type: "news" }], "Marvel", null, marvelRegistered)).toHaveLength(0);
  });
  it("Marvel App's name 'Marvel App' does not even match the brand label marvel.com", () => {
    expect(brandLabelMatches("https://www.marvel.com/", "Marvel App")).toBe(false);
  });
  it("datax.com and dataxltd.com for DataX (registered datax.co.jp, unreadable): no evidence, not DataX's", () => {
    const none = { host: "datax.co.jp", pages: [] };
    expect(ownBrandSources([{ url: "https://www.datax.com/about", title: "DataX", content: "DataX is a data company", source_type: "news" }], "DataX", null, none)).toHaveLength(0);
    expect(ownBrandSources([{ url: "https://dataxltd.com/", title: "DataX Ltd", content: "DataX, Ltd. credit data, an Equifax company", source_type: "news" }], "DataX", null, none)).toHaveLength(0);
  });
  it("even with the registered site read, datax.com without a link, contact or product is not DataX's", () => {
    const jp = { host: "datax.co.jp", pages: [{ url: "https://datax.co.jp/", content: "DataX Japan 株式会社 info@datax.co.jp +81 3 1234 5678" }] };
    expect(ownBrandSources([{ url: "https://www.datax.com/about", title: "DataX", content: "DataX is a data company. info@datax.com +1 702 555 0100", source_type: "news" }], "DataX", null, jp)).toHaveLength(0);
  });
  it("aerobotix.com: the registered site (aerobotix.co.il) links to it", () => {
    const reg = { host: "aerobotix.co.il", pages: [{ url: "https://aerobotix.co.il/", content: "Aerobotix — see also [aerobotix.com](https://aerobotix.com)" }] };
    const r = ownBrandSources([{ url: "https://aerobotix.com/", title: "Aerobotix", content: "Aerobotix in Huntsville", source_type: "news" }], "Aerobotix", null, reg);
    expect(r).toHaveLength(1);
    expect(r[0].ownHow).toMatch(/linked/);
  });
  it("moft.com: the same e-mail address as the registered moft.us", () => {
    const reg = { host: "moft.us", pages: [{ url: "https://moft.us/pages/contact", content: "Write to support@moft.com or call +1 (509) 555-0134" }] };
    const r = ownBrandSources([{ url: "https://www.moft.com/pages/company-info", title: "Company Info", content: "MOFT, Spokane. support@moft.com", source_type: "news" }], "Moft", null, reg);
    expect(r).toHaveLength(1);
    expect(r[0].ownHow).toMatch(/e-mail|phone|address/);
  });
  it("the pieces: e-mails, phones (national number), street addresses, product names from headings", () => {
    expect([...emailsIn("Mail Hello@Acme.com.")]).toEqual(["hello@acme.com"]);
    expect([...phonesIn("Call +972 (3) 123-4567 or 054-123-4567")]).toContain("31234567");
    expect([...addressesIn("Visit us at 20 Bartholomew St, London")]).toEqual(["20 bartholomew street"]);
    expect(productTerms([{ url: "x", title: "Acme", content: "# FlowDesk\n# A-CAES\n# Pricing\n# About" }], "Acme")).toEqual(expect.arrayContaining(["FlowDesk", "A-CAES"]));
    expect(productTerms([{ url: "x", title: "Acme", content: "# Pricing\n# About us" }], "Acme")).toEqual([]);
  });
  it("an e-mail address at a domain is not a link to it", () => {
    expect(mentionsAddress("Write to support@moft.com", "moft.com")).toBe(false);
    expect(mentionsAddress("See [moft.com](https://www.moft.com/us)", "moft.com")).toBe(true);
    expect(mentionsAddress("Also at www.aerobotix.com", "aerobotix.com")).toBe(true);
    expect(mentionsAddress("notmoft.com is another", "moft.com")).toBe(false);
  });
  it("a product name of the registered site on the page is evidence (c)", () => {
    const reg = { host: "acme.io", pages: [{ url: "https://acme.io/", title: "Acme", content: "# FlowDesk\nWorkflow tool" }] };
    expect(ownEvidence({ url: "https://acme.com/", content: "Acme FlowDesk now available" }, reg, "Acme")?.how).toBe("product");
    expect(ownEvidence({ url: "https://acme.com/", content: "Acme sells ladders" }, reg, "Acme")).toBeNull();
  });
});
