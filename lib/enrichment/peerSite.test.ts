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
  it("one distinctive word of the name in the host is enough (owner, 2026-11-13)", () => {
    expect(pickPeerSite([{ url: "https://aws.amazon.com/security" }], "Amazon Web Services")).toBe("https://aws.amazon.com");
    expect(pickPeerSite([{ url: "https://www.dig.security/product" }], "Dig Security")).toBe("https://www.dig.security");
    expect(pickPeerSite([{ url: "https://aws.com/x" }, { url: "https://example.com" }], "Amazon Web Services")).toBe("https://aws.com");   // the initials
    expect(pickPeerSite([{ url: "https://security.example.com" }], "Dig Security")).toBeNull();       // a kind of business is not a name
    expect(pickPeerSite([{ url: "https://cloud-services.example.net" }], "Amazon Web Services")).toBeNull();
  });
  it("the best result wins: the whole name over one word", () => {
    expect(pickPeerSite([{ url: "https://amazon.example.org" }, { url: "https://amazonwebservices.com" }], "Amazon Web Services")).toBe("https://amazonwebservices.com");
  });
});
