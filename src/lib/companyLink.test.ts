import { describe, it, expect } from "vitest";
import { slugifyName, companyPermalinkPath, parseCompanySlug } from "./companyLink";

const ID = "3f2a9c1e-5b7d-4c8a-9e10-6a1b2c3d4e5f";

describe("slugifyName", () => {
  it("lower-cases and joins words", () => expect(slugifyName("Ibex Medical Analytics")).toBe("ibex-medical-analytics"));
  it("drops accents and punctuation", () => expect(slugifyName("São Paulo Labs, Inc.")).toBe("sao-paulo-labs-inc"));
  it("spells out an ampersand", () => expect(slugifyName("AT&T Research")).toBe("at-and-t-research"));
  it("is empty when no latin letters or digits remain", () => expect(slugifyName("株式会社")).toBe(""));
  it("caps the length without leaving a trailing dash", () => {
    const s = slugifyName("a".repeat(59) + " bbbbbbbb");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("companyPermalinkPath", () => {
  it("puts the name before the id", () => expect(companyPermalinkPath("Ibex Medical", ID)).toBe(`/company/ibex-medical-${ID}`));
  it("falls back to the id alone", () => expect(companyPermalinkPath("株式会社", ID)).toBe(`/company/${ID}`));
});

describe("parseCompanySlug", () => {
  it("reads the id from a full link", () => expect(parseCompanySlug(`ibex-medical-${ID}`)).toBe(ID));
  it("reads a bare id", () => expect(parseCompanySlug(ID)).toBe(ID));
  it("ignores the name part, so a renamed company's old link still works", () => expect(parseCompanySlug(`old-name-${ID}`)).toBe(ID));
  it("normalises case", () => expect(parseCompanySlug(`x-${ID.toUpperCase()}`)).toBe(ID));
  it("rejects anything without a trailing id", () => {
    expect(parseCompanySlug("ibex-medical")).toBeNull();
    expect(parseCompanySlug(`${ID}-extra`)).toBeNull();
    expect(parseCompanySlug("")).toBeNull();
    expect(parseCompanySlug(undefined)).toBeNull();
  });
  it("round-trips", () => expect(parseCompanySlug(companyPermalinkPath("Ibex Medical", ID).replace("/company/", ""))).toBe(ID));
});
