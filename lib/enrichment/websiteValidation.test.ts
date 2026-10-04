import { describe, it, expect } from "vitest";
import { websiteDomain, isGenericDirectoryDomain, normalizeWebsiteUrl, validateWebsiteCandidate, type DomainOwner } from "./websiteValidation";

describe("websiteDomain", () => {
  it("extracts the bare hostname, stripping www", () => {
    expect(websiteDomain("https://www.apexspace.com/about")).toBe("apexspace.com");
    expect(websiteDomain("apexspace.com")).toBe("apexspace.com");
  });
  it("returns null for garbage input", () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain("")).toBeNull();
  });
});

describe("isGenericDirectoryDomain", () => {
  it("flags known aggregators/registries/social networks", () => {
    expect(isGenericDirectoryDomain("crunchbase.com")).toBe(true);
    expect(isGenericDirectoryDomain("linkedin.com")).toBe(true);
    expect(isGenericDirectoryDomain("find-and-update.company-information.service.gov.uk")).toBe(true);
    expect(isGenericDirectoryDomain("example.com")).toBe(true);
  });
  it("flags a subdomain of a generic domain too", () => {
    expect(isGenericDirectoryDomain("news.crunchbase.com")).toBe(true);
  });
  it("does not flag a real company domain", () => {
    expect(isGenericDirectoryDomain("apexspace.com")).toBe(false);
  });
});

describe("normalizeWebsiteUrl", () => {
  it("strips protocol, www, and trailing slashes into one canonical form", () => {
    expect(normalizeWebsiteUrl("apexspace.com")).toBe("https://apexspace.com");
    expect(normalizeWebsiteUrl("http://www.apexspace.com/")).toBe("https://apexspace.com");
    expect(normalizeWebsiteUrl("https://apexspace.com///")).toBe("https://apexspace.com");
  });
});

describe("validateWebsiteCandidate", () => {
  const byDomain = new Map<string, DomainOwner>([
    ["apexspace.com", { id: "startup-1", name: "Apex" }],
  ]);

  it("accepts a clean, unclaimed real domain", () => {
    const result = validateWebsiteCandidate("freshdomain.com", "startup-2", new Map());
    expect(result.website).toBe("https://freshdomain.com");
  });

  it("rejects a generic directory/aggregator link", () => {
    const result = validateWebsiteCandidate("https://www.crunchbase.com/organization/apex", "startup-2", new Map());
    expect(result.website).toBeNull();
    expect(result.rejectedReason).toBe("generic_directory");
  });

  it("accepts a domain already on file for the SAME startup", () => {
    const result = validateWebsiteCandidate("https://www.apexspace.com", "startup-1", byDomain);
    expect(result.website).toBe("https://apexspace.com");
  });

  it("rejects a domain already claimed by a DIFFERENT startup (the UNIQUE constraint case)", () => {
    const result = validateWebsiteCandidate("https://www.apexspace.com", "startup-2", byDomain);
    expect(result.website).toBeNull();
    expect(result.rejectedReason).toBe("claimed_by_other_startup");
    expect(result.rejectedOwnerName).toBe("Apex");
  });
});
