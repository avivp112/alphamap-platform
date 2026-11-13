import { describe, it, expect } from "vitest";
import { contextWords, peerSiteQuery, pickPeerSite } from "./peerSite";

describe("a market candidate's own site (run 12 check)", () => {
  it("the query carries the sentence's context, not the names", () => {
    expect(contextWords("UK telehealth market: Doctor Care Anywhere, Teladoc Health, Livi and Other Industry Leaders", ["Livi", "Teladoc Health"])).toEqual(["telehealth", "doctor", "anywhere", "industry"]);
    expect(peerSiteQuery("Livi", "UK telehealth market insights featuring Livi", "Kry")).toBe('"Livi" telehealth insights featuring official site');
  });
  it("only an address that carries the candidate's name is its own", () => {
    const results = [{ url: "https://www.livitemplates.shop/x" }, { url: "https://www.crunchbase.com/organization/moneytap" }, { url: "https://www.moneytap.com/about" }, { url: "https://en.wikipedia.org/wiki/MoneyTap" }];
    expect(pickPeerSite(results, "MoneyTap")).toBe("https://www.moneytap.com");
    expect(pickPeerSite([{ url: "https://play.google.com/store/apps/details?id=x" }, { url: "https://random-games.com" }], "EarlySalary")).toBeNull();
    expect(pickPeerSite([{ url: "https://policybazaar.com/insurance" }], "Policybazaar")).toBe("https://policybazaar.com");
  });
});
