import { describe, it, expect } from "vitest";
import { siteBelongsToAnotherCompany } from "./siteOwner";

const filler = " The platform helps customers collect feedback and measure experience across every channel with surveys and analytics.".repeat(6);

describe("a website that belongs to another company now (review 7, 2026-11-09)", () => {
  it("Cinsay: the pages say it is now part of aibuy", () => {
    const r = siteBelongsToAnotherCompany("Cinsay", "https://cinsay.com", [{ url: "https://cinsay.com", content: "Cinsay is now part of aibuy. Shoppable video for brands." + filler }]);
    // Owner, batch 7: an acquired company is enriched as usual; its page that says it was bought is still its page (the description needs a sentence that names the company anyway).
    expect(r).toBeNull();
  });
  it("CheckMarket: the pages never name it and carry the buyer's copyright", () => {
    const r = siteBelongsToAnotherCompany("CheckMarket", "https://checkmarket.com", [{ url: "https://checkmarket.com", content: "Medallia Experience Cloud." + filler + " © 2026 Medallia Inc." }]);
    expect(r).toMatch(/never names CheckMarket/);
    expect(r).toMatch(/Medallia/);
  });
  it("a company that is named on its own site is left alone", () => {
    expect(siteBelongsToAnotherCompany("Wayve", "https://wayve.ai", [{ url: "https://wayve.ai", content: "Wayve builds embodied AI for driving. " + filler }])).toBeNull();
  });
  it("a site whose domain name is on the page is the company's, even under a different display name", () => {
    expect(siteBelongsToAnotherCompany("Acme Labs", "https://acmecloud.io", [{ url: "https://acmecloud.io", content: "Welcome to acmecloud. " + filler }])).toBeNull();
  });
  it("no pages, no judgement", () => {
    expect(siteBelongsToAnotherCompany("X", "https://x.com", [])).toBeNull();
  });
});

describe("review 8 (2026-11-10): an address that leads to another company", () => {
  const page = (url: string, finalUrl: string, text: string) => ({ url, content: `Title: x URL Source: ${url} Final URL: ${finalUrl} Published Time: Fri, 06 Nov 2026 Markdown Content: ${text}` });
  it("Hofy and Ezetap: the site the address leads to is Deel's and Razorpay's", () => {
    expect(siteBelongsToAnotherCompany("Hofy", "https://hofy.com", [page("https://hofy.com/", "https://www.deel.com/it/", "Deel IT. Manage devices.")])).toMatch(/hofy's address leads to www\.deel\.com/);
    expect(siteBelongsToAnotherCompany("Ezetap", "https://ezetap.com", [page("https://ezetap.com/", "https://razorpay.com/pos/", "Razorpay POS.")])).toMatch(/razorpay\.com/);
  });
  it("www, a country domain, or a longer name on the same brand are the same company", () => {
    expect(siteBelongsToAnotherCompany("Sedric", "https://sedric.ai", [page("https://sedric.ai/", "https://www.sedric.ai/", "Sedric reviews content." + filler)])).toBeNull();
    expect(siteBelongsToAnotherCompany("Verbit", "https://verbit.ai/about", [page("https://verbit.ai/about", "https://verbit.ai/about-us/", "About Verbit." + filler)])).toBeNull();
    expect(siteBelongsToAnotherCompany("Bolt", "https://getbolt.com", [page("https://getbolt.com/", "https://bolt.com/", "Bolt checkout." + filler)])).toBeNull();
  });
  it("Superhuman: the page says another company is now this one", () => {
    expect(siteBelongsToAnotherCompany("Superhuman", "https://superhuman.com", [{ url: "https://superhuman.com", content: "Grammarly is now Superhuman. The AI productivity suite." + filler }])).toMatch(/acquired \/ rebranded/);
  });
});

describe("round 8 (2026-11-15): a move to a new address is not an acquisition when the new site names the company", () => {
  const page = (url: string, finalUrl: string, text: string) => ({ url, content: `Title: x URL Source: ${url} Final URL: ${finalUrl} Markdown Content: ${text}` });
  it("tymebank.co.za → gotyme.co.za: TymeBank Limited is on the destination — the same company", () => {
    expect(siteBelongsToAnotherCompany("TymeBank", "https://tymebank.co.za", [page("https://tymebank.co.za/", "https://gotyme.co.za/", "GoTyme. Banking by TymeBank Limited, an authorised financial services provider." + filler)])).toBeNull();
  });
  it("Hofy → deel.com still is flagged when Deel is the buyer in the page's own words", () => {
    expect(siteBelongsToAnotherCompany("Hofy", "https://hofy.com", [page("https://hofy.com/", "https://www.deel.com/it/", "Deel acquires Hofy to bring IT to every team. " + filler)])).toMatch(/acquired \/ rebranded/);
  });
});

import { acquisitionHeadline } from "./siteOwner";
describe("a headline in which the company is the one acquired (domain_repurposed)", () => {
  it("is", () => {
    expect(acquisitionHeadline("Aerodrome expanding drone offering with $4.5 million acquisition of FlyTech", "FlyTech")).toBe(true);
    expect(acquisitionHeadline("Equifax Acquires DataX to Expand Credit Access for Consumers", "DataX")).toBe(true);
    expect(acquisitionHeadline("Cinsay is being acquired by aibuy", "Cinsay")).toBe(true);
  });
  it("is not, when the company buys, or only joins or launches", () => {
    expect(acquisitionHeadline("Ghost joins the fediverse", "Ghost")).toBe(false);
    expect(acquisitionHeadline("Ghost 6.0 launches", "Ghost")).toBe(false);
    expect(acquisitionHeadline("Wiz acquires Dazz for $450 million", "Wiz")).toBe(false);
  });
});

import { rebrandedAs } from "./siteOwner";
describe("renamed is not acquired (owner, round 10: TymeBank → GoTyme Bank)", () => {
  it("a rename is found and is no site-owner issue; an acquisition still is", () => {
    const pages = [{ url: "https://gotyme.co.za", content: "GoTyme Bank (formerly TymeBank) is a digital bank." }];
    expect(rebrandedAs("TymeBank", pages)).toBe("GoTyme Bank");
    expect(siteBelongsToAnotherCompany("TymeBank", "https://tymebank.co.za", pages)).toBeNull();
    expect(rebrandedAs("Acme", [{ url: "u", content: "Acme is now part of Globex." }])).toBeNull();
    expect(siteBelongsToAnotherCompany("Acme", "https://acme.com", [{ url: "u", content: "Acme has been acquired by Globex Corporation and is now part of it." }])).toBeNull();
  });
});

import { redirectBrand } from "./siteOwner";
describe("the brand a registered address leads to (owner, round 10)", () => {
  it("TymeBank's address leads to GoTyme Bank's site", () => {
    const pages = [{ url: "https://tymebank.co.za", content: "Title: GoTyme Bank\nURL Source: https://tymebank.co.za\nFinal URL: https://www.gotyme.co.za/\n\nMarkdown Content:\nGoTyme Bank, formerly TymeBank, is a digital bank. Open an account with GoTyme Bank today." }];
    expect(redirectBrand("TymeBank", "https://tymebank.co.za", pages)).toBe("GoTyme Bank");
    expect(redirectBrand("Acme", "https://acme.com", [{ url: "u", content: "Final URL: https://acme.com/\n\nMarkdown Content:\nAcme" }])).toBeNull();
  });
});

import { isTrackingHost } from "./siteOwner";
describe("a redirect through an advertising endpoint is no rebrand (owner, batch 7: MyHR → match.adsrvr.org)", () => {
  it("recognises tracking hosts", () => {
    for (const h of ["match.adsrvr.org", "ad.doubleclick.net", "www.googleadservices.com", "cm.g.doubleclick.net", "pixel.rubiconproject.com", "click.linksynergy.com"]) expect(isTrackingHost(h), h).toBe(true);
    for (const h of ["myhr.works", "deel.com", "gotyme.co.za", "advisor.com"]) expect(isTrackingHost(h), h).toBe(false);
  });
  it("the address that leads through one is not another company's site", () => {
    const pages = [{ url: "https://myhr.works", content: "Final URL: https://match.adsrvr.org/track/cmf/generic\n\nMarkdown Content:\nMyHR is the online HR department. " + "MyHR helps NZ businesses with HR, payroll and people tools. ".repeat(12) }];
    expect(siteBelongsToAnotherCompany("MyHR", "https://myhr.works", pages)).toBeNull();
    expect(redirectBrand("MyHR", "https://myhr.works", pages)).toBeNull();
  });
});
