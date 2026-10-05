import { describe, it, expect } from "vitest";
import { isDistinctiveName, filterByEntity, filterResultsByEntity, deriveIdentityKeywords, type EntityAnchors } from "./entity";

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

describe("identity keywords -- non-distinctive names (Ghost, Foundry, Gifted) without starving news/competitors", () => {
  const ghostSite = [
    "Ghost: The best open source blog & newsletter platform. Independent publishing with paid membership subscriptions.",
    "Ghost is a publishing platform for newsletters and paid membership. Creators publish content and grow subscriptions.",
  ];
  const keywords = deriveIdentityKeywords(ghostSite, "Ghost");

  it("derives the words that characterize the company from its own site, never the name or generic filler", () => {
    expect(keywords).toEqual(expect.arrayContaining(["newsletter", "membership", "publishing"]));
    expect(keywords).not.toContain("ghost");
    expect(keywords).not.toContain("platform");
  });

  it("keeps a news article that names Ghost and talks about publishing/newsletters (was dropped as not_distinctive_name before)", () => {
    const verdict = filterByEntity(
      { url: "https://techcrunch.com/ghost-activitypub", title: "Ghost adds ActivityPub", snippet: "Ghost, the open source newsletter and publishing platform, now federates." },
      { identityKeywords: keywords }, "Ghost",
    );
    expect(verdict.kept).toBe(true);
    expect(verdict.matched).toBe("identity_keywords");
  });

  it("still drops a different same-named company (Ghost Robotics) — the collision issue 2 exists for", () => {
    const verdict = filterByEntity(
      { url: "https://techcrunch.com/ghost-robotics", title: "Ghost Robotics raises $100M", snippet: "Ghost Robotics builds legged quadruped robots for defense." },
      { identityKeywords: keywords }, "Ghost",
    );
    expect(verdict.kept).toBe(false);
  });

  it("does not apply with fewer than two identity keywords (too weak to tell companies apart)", () => {
    const verdict = filterByEntity(
      { url: "https://x.com/a", snippet: "Ghost newsletter update" },
      { identityKeywords: ["newsletter"] }, "Ghost",
    );
    expect(verdict.kept).toBe(false);
  });
});

describe("namesake domains and generic keyword hits (Glean AI got Glean's $7.2B valuation)", () => {
  const anchors: EntityAnchors = { domain: "glean.ai", identityKeywords: ["spend", "vendor", "invoice", "payable", "accounting", "intelligence", "drive"] };
  it("drops a result about the namesake's own domain", () => {
    const v = filterByEntity({ url: "https://telosi.io/vr/glean", snippet: "Glean (glean.com) Work AI platform reached $300M ARR" }, anchors, "Glean AI");
    expect(v).toEqual({ kept: false, drop_reason: "namesake_domain" });
    expect(filterByEntity({ url: "https://www.glean.com/blog/x", snippet: "Glean AI assistant" }, anchors, "Glean AI").kept).toBe(false);
  });
  it("keeps a page that mentions both domains (it names ours)", () => {
    expect(filterByEntity({ url: "https://x.com/suit", snippet: "glean.com sued by glean.ai over the trademark" }, anchors, "Glean AI").matched).toBe("domain_mention");
  });
  it("needs a core identity keyword, not just two generic ones", () => {
    expect(filterByEntity({ url: "https://x.com/a", snippet: "Glean AI brings intelligence to your drive" }, { identityKeywords: anchors.identityKeywords }, "Glean AI").kept).toBe(false);
    expect(filterByEntity({ url: "https://x.com/b", snippet: "Glean AI automates invoice and vendor spend" }, { identityKeywords: anchors.identityKeywords }, "Glean AI").kept).toBe(true);
  });
});

describe("distinctive names must actually be mentioned", () => {
  it("drops a partial match about a different company (Global Relay got Relay's rounds)", () => {
    expect(filterByEntity({ url: "https://www.clay.com/dossier/relay-funding", snippet: "Relay raised a $32.2M Series B" }, {}, "Global Relay"))
      .toEqual({ kept: false, drop_reason: "name_not_mentioned" });
    expect(filterByEntity({ url: "https://www.crunchbase.com/organization/global-relay", snippet: "Archiving and compliance." }, {}, "Global Relay").kept).toBe(true);
  });
});

describe("namesake LinkedIn company pages", () => {
  it("drops another linkedin.com/company page when the company's own is on file", () => {
    const anchors: EntityAnchors = { companyLinkedinUrl: "https://www.linkedin.com/company/globalstep" };
    expect(filterByEntity({ url: "https://pt.linkedin.com/company/globalstep-inform%C3%A1tica", snippet: "GlobalStep fundada em 2001" }, anchors, "GlobalStep"))
      .toEqual({ kept: false, drop_reason: "namesake_profile" });
    expect(filterByEntity({ url: "https://www.linkedin.com/company/globalstep/", snippet: "GlobalStep game QA" }, anchors, "GlobalStep").kept).toBe(true);
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
