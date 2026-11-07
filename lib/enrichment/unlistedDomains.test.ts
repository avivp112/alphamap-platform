import { describe, it, expect } from "vitest";
import { roundSourceStanding } from "./roundSources";
import { looksLikeMajorPress, majorPressNote } from "./unlistedDomains";
import { isTrustedNewsUrl } from "./trustedNews";

describe("outlets the owner listed as tier 2 (2026-11-07)", () => {
  for (const d of ["nytimes.com", "washingtonpost.com", "theguardian.com", "economist.com", "apnews.com", "bbc.com", "bbc.co.uk", "barrons.com", "marketwatch.com", "latimes.com"]) {
    it(`${d} is allowed, tier 2, subdomains too`, () => {
      expect(roundSourceStanding(`https://www.${d}/2026/06/10/business/x.html`)).toMatchObject({ kind: "allowed", tier: 2 });
      expect(roundSourceStanding(`https://sub.${d}/a`)).toMatchObject({ kind: "allowed", tier: 2 });
    });
  }
  it("barrons.com, marketwatch.com and latimes.com are trusted for competitors too", () => {
    for (const d of ["barrons.com", "marketwatch.com", "latimes.com"]) expect(isTrustedNewsUrl(`https://www.${d}/x`)).toBe(true);
  });
});

describe("the report points out an unlisted domain that looks like tier-2 press (owner, 2026-11-07)", () => {
  it("names a major outlet that is not listed, and not a listed or unknown one", () => {
    expect(looksLikeMajorPress("https://www.cnn.com/a")).toBe(true);
    expect(looksLikeMajorPress("nytimes.com")).toBe(false);
    expect(looksLikeMajorPress("some-random-blog.net")).toBe(false);
  });
  it("one line, each domain once", () => {
    expect(majorPressNote(["cnn.com", "www.cnn.com", "random.io", "nytimes.com"])).toBe("Unlisted domains that look like tier-2 press — your decision (list one, or deny it): cnn.com");
    expect(majorPressNote(["random.io"])).toBeNull();
  });
});
