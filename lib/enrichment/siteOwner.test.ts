import { describe, it, expect } from "vitest";
import { siteBelongsToAnotherCompany } from "./siteOwner";

const filler = " The platform helps customers collect feedback and measure experience across every channel with surveys and analytics.".repeat(6);

describe("a website that belongs to another company now (review 7, 2026-11-09)", () => {
  it("Cinsay: the pages say it is now part of aibuy", () => {
    const r = siteBelongsToAnotherCompany("Cinsay", "https://cinsay.com", [{ url: "https://cinsay.com", content: "Cinsay is now part of aibuy. Shoppable video for brands." + filler }]);
    expect(r).toMatch(/^acquired \/ rebranded/);
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
