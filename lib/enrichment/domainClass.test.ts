import { describe, it, expect, beforeEach } from "vitest";
import { domainClassKey, domainClasses, parseDomainClass, standingOfClass, domainClassesCsv } from "./domainClass.ts";
import { classifyUnknownDomains } from "./domainClassify.ts";
import { roundSourceStanding, isDirectoryPage } from "./roundSources.ts";

beforeEach(() => domainClasses.clear());

describe("domain classes (owner, 2026-11-14)", () => {
  it("keys a domain, and a section of it that is a different kind of page", () => {
    expect(domainClassKey("https://www.moneycontrol.com/news/x.html")).toBe("moneycontrol.com");
    expect(domainClassKey("https://www.automate.org/companies/aerobotix")).toBe("automate.org/companies");
    expect(domainClassKey("https://www.mux.com/partners/jump")).toBe("mux.com/partners");
    expect(domainClassKey("https://en.ain.ua/2020/09/25/x/")).toBe("ain.ua");
  });
  it("an outlet or a wire that is on no list is tier 4, the weakest; the rest is blocked; an investor follows the investor rule", () => {
    expect(standingOfClass("news_outlet")).toMatchObject({ kind: "allowed", tier: 4, lowConfidence: true });
    expect(standingOfClass("wire")).toMatchObject({ kind: "allowed", tier: 4, lowConfidence: true });
    for (const c of ["company_owned", "directory_aggregator", "blog_vendor_other"] as const) expect(standingOfClass(c)).toMatchObject({ kind: "denied" });
    expect(standingOfClass("investor")).toBeNull();
  });
  it("is used only for a domain on no list: the hard lists win", () => {
    domainClasses.set({ key: "bouncewatch.com", class: "news_outlet", reason: "x", example_url: "", example_title: "", at: "" });
    domainClasses.set({ key: "siliconrepublic.com", class: "blog_vendor_other", reason: "x", example_url: "", example_title: "", at: "" });
    expect(roundSourceStanding("https://bouncewatch.com/alternatives/x").kind).toBe("denied");
    expect(roundSourceStanding("https://www.siliconrepublic.com/start-ups/x")).toMatchObject({ kind: "allowed", tier: 4 });
  });
  it("an unlisted domain becomes allowed (tier 4) or blocked once classified", () => {
    expect(roundSourceStanding("https://www.newswire.ca/news-releases/x").kind).toBe("unlisted");
    domainClasses.set({ key: "newswire.ca", class: "wire", reason: "", example_url: "", example_title: "", at: "" });
    domainClasses.set({ key: "revenuebase.ai/companies", class: "directory_aggregator", reason: "", example_url: "", example_title: "", at: "" });
    expect(roundSourceStanding("https://www.newswire.ca/news-releases/x")).toMatchObject({ kind: "allowed", tier: 4, lowConfidence: true });
    expect(roundSourceStanding("https://revenuebase.ai/companies/x/uk").kind).toBe("denied");
  });
  it("classifies each unknown domain once, not the listed, not the company's own, not the already known", async () => {
    let calls = 0;
    const ask = async () => { calls++; return { class: "news_outlet", reason: "r" }; };
    const sources = [
      { url: "https://www.techcrunch.com/a", title: "t" },                 // on the tier-2 list
      { url: "https://www.acme.com/about", title: "t" },                    // the company's own
      { url: "https://www.unknownpress.com/a", title: "t" }, { url: "https://www.unknownpress.com/b", title: "t" },
    ];
    expect(await classifyUnknownDomains(sources, { ask, isCompanySite: (u) => u.includes("acme.com") })).toBe(1);
    expect(calls).toBe(1);
    expect(await classifyUnknownDomains(sources, { ask, isCompanySite: (u) => u.includes("acme.com") })).toBe(0);
    expect(domainClasses.newThisRun().map((e) => e.key)).toEqual(["unknownpress.com"]);
  });
  it("a failed call leaves the domain unclassified (tried again next time)", async () => {
    const n = await classifyUnknownDomains([{ url: "https://flaky.com/a", title: "t" }], { ask: async () => { throw new Error("api"); }, isCompanySite: () => false });
    expect(n).toBe(0);
    expect(roundSourceStanding("https://flaky.com/a").kind).toBe("unlisted");
  });
  it("an odd answer is blog_vendor_other (blocked)", () => {
    expect(parseDomainClass({ class: "weird" }).class).toBe("blog_vendor_other");
  });
  it("writes the owner's list of new classes", () => {
    domainClasses.set({ key: "newswire.ca", class: "wire", reason: "a wire", example_url: "https://newswire.ca/x", example_title: "T", at: "" });
    expect(domainClassesCsv(domainClasses.newThisRun())).toContain("newswire.ca,wire,\"allowed, tier 4 (weakest)\",a wire");
  });
});

describe("moneycontrol: an article under /companies/ is not a directory page", () => {
  it("is a tier 3 article, not 'denied'", () => {
    const u = "https://www.moneycontrol.com/news/business/companies/dmi-group-acquires-bnpl-startup-zestmoney-in-a-fire-sale-deal-12072291.html";
    expect(isDirectoryPage(u)).toBe(false);
    expect(roundSourceStanding(u)).toMatchObject({ kind: "allowed", tier: 3 });
  });
  it("a real directory page still is", () => {
    expect(isDirectoryPage("https://www.eu-startups.com/directory/docplanner")).toBe(true);
    expect(isDirectoryPage("https://www.inc42.com/company/cultfit")).toBe(true);
  });
});
