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
