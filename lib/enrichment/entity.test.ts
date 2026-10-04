import { describe, it, expect } from "vitest";
import { isDistinctiveName, filterByEntity, filterResultsByEntity, type EntityAnchors } from "./entity";

describe("isDistinctiveName", () => {
  it("rejects the spec's own example common names", () => {
    for (const name of ["Apex", "Nova", "Atlas", "Orbit", "Pulse"]) {
      expect(isDistinctiveName(name)).toBe(false);
    }
  });
  it("rejects a single dictionary word even if not on the curated list", () => {
    expect(isDistinctiveName("Bridge")).toBe(false);
    expect(isDistinctiveName("Compass")).toBe(false);
  });
  it("rejects a generic name even wrapped in a corporate suffix", () => {
    expect(isDistinctiveName("Apex Labs")).toBe(false);
    expect(isDistinctiveName("Apex AI")).toBe(false);
    expect(isDistinctiveName("Apex Inc")).toBe(false);
  });
  it("rejects anything under 5 characters after stripping suffixes", () => {
    expect(isDistinctiveName("Wiz")).toBe(false); // also a real dictionary word
    expect(isDistinctiveName("Zepto")).toBe(true); // 5 chars, not a dictionary word
  });
  it("accepts a genuinely distinctive, multi-word or invented name", () => {
    expect(isDistinctiveName("Apex Space")).toBe(true); // "Apex Space" together isn't generic
    expect(isDistinctiveName("Fresha")).toBe(true);
    expect(isDistinctiveName("Safe Superintelligence")).toBe(true);
  });
});

describe("filterByEntity", () => {
  const anchors: EntityAnchors = {
    domain: "apexspace.com",
    founderNames: ["Ian Cinnamon", "Max Benassi"],
    verifiedProfileUrls: ["https://www.linkedin.com/company/apex-space"],
    trustedCountry: "United States",
  };

  it("keeps a result whose URL is on the verified domain", () => {
    const verdict = filterByEntity({ url: "https://www.apexspace.com/news/raise" }, anchors, "Apex");
    expect(verdict.kept).toBe(true);
    expect(verdict.matched).toBe("domain_url");
  });

  it("keeps a third-party article that mentions the domain", () => {
    const verdict = filterByEntity(
      { url: "https://techcrunch.com/apex-raises", snippet: "Apex, found at apexspace.com, raised $16M." },
      anchors, "Apex",
    );
    expect(verdict.kept).toBe(true);
    expect(verdict.matched).toBe("domain_mention");
  });

  it("keeps a result that mentions a known founder, even off-domain", () => {
    const verdict = filterByEntity(
      { url: "https://news.ycombinator.com/item?id=1", snippet: "Ian Cinnamon is hiring for Apex." },
      anchors, "Apex",
    );
    expect(verdict.kept).toBe(true);
    expect(verdict.matched).toBe("founder_mention");
  });

  it("drops a same-named company's page with no anchor match (the collision case issue 2 exists for)", () => {
    const verdict = filterByEntity(
      { url: "https://www.apexclearing.com/about", title: "Apex Clearing — fintech infrastructure", snippet: "A totally different Apex." },
      anchors, "Apex",
    );
    expect(verdict.kept).toBe(false);
    expect(verdict.drop_reason).toBe("not_distinctive_name");
  });

  it("drops a result that contradicts a trusted country anchor", () => {
    const verdict = filterByEntity(
      { url: "https://example.com/some-apex", snippet: "Apex Space, a United Kingdom-based startup, announced..." },
      anchors, "Apex Space", // distinctive two-word name, so it survives to the contradiction check
    );
    expect(verdict.kept).toBe(false);
    expect(verdict.drop_reason).toBe("country_contradiction");
  });

  it("keeps a distinctive name with no anchor match and no contradiction", () => {
    const verdict = filterByEntity(
      { url: "https://example.com/safe-superintelligence-raises", snippet: "Safe Superintelligence raised $1B." },
      { trustedCountry: "United States" }, "Safe Superintelligence",
    );
    expect(verdict.kept).toBe(true);
    expect(verdict.matched).toBe("distinctive_name");
  });
});

describe("filterResultsByEntity", () => {
  it("flags low_evidence when fewer than 2 results survive", () => {
    const anchors: EntityAnchors = { domain: "apexspace.com" };
    const results = [
      { url: "https://www.apexclearing.com/", snippet: "unrelated Apex" },
      { url: "https://www.apexsystems.com/", snippet: "also unrelated Apex" },
    ];
    const out = filterResultsByEntity(results, anchors, "Apex");
    expect(out.kept).toHaveLength(0);
    expect(out.status).toBe("low_evidence");
  });

  it("status is ok once 2+ results survive", () => {
    const anchors: EntityAnchors = { domain: "apexspace.com" };
    const results = [
      { url: "https://www.apexspace.com/about" },
      { url: "https://techcrunch.com/x", snippet: "apexspace.com raised money" },
    ];
    const out = filterResultsByEntity(results, anchors, "Apex");
    expect(out.kept).toHaveLength(2);
    expect(out.status).toBe("ok");
  });
});
