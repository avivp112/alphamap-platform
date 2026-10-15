import { describe, it, expect } from "vitest";
import { registryUrl, formatUsd, formatPeople, evidenceLines } from "./candidateReview";

describe("registryUrl", () => {
  it("links each source to its official record", () => {
    expect(registryUrl({ source: "sec_form_d", cik: "0001234567", entity_number: null, name: "APR Labs Inc." }))
      .toBe("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001234567&type=D");
    expect(registryUrl({ source: "uk_companies_house", cik: null, entity_number: "16123456", name: "IDMON LIMITED" }))
      .toBe("https://find-and-update.company-information.service.gov.uk/company/16123456");
    expect(registryUrl({ source: "epo_ops", cik: null, entity_number: null, name: "Field AI, Inc." }))
      .toBe("https://worldwide.espacenet.com/patent/search?q=pa%3D%22Field%20AI%2C%20Inc.%22");
  });
  it("returns null rather than a broken link", () => {
    expect(registryUrl({ source: "sec_form_d", cik: null, entity_number: null, name: "x" })).toBeNull();
    expect(registryUrl({ source: "uk_companies_house", cik: null, entity_number: null, name: "x" })).toBeNull();
    expect(registryUrl({ source: "something_else", cik: "1", entity_number: "2", name: "x" })).toBeNull();
  });
});

describe("formatUsd / formatPeople", () => {
  it("formats Form D amounts", () => {
    expect(formatUsd(24_999_982)).toBe("$25M");
    expect(formatUsd(2_500_000)).toBe("$2.5M");
    expect(formatUsd(260_000)).toBe("$260K");
    expect(formatUsd(0)).toBeNull();
    expect(formatUsd(null)).toBeNull();
  });
  it("lists people with roles, capped", () => {
    expect(formatPeople([{ name: "Jane Doe", relationships: ["Director"] }, { name: "John Roe", relationships: [] }]))
      .toBe("Jane Doe (director), John Roe");
    expect(formatPeople([{ name: "A" }, { name: "B" }, { name: "C" }], 2)).toBe("A, B +1");
    expect(formatPeople([{ name: " " }])).toBeNull();
  });
});

describe("evidenceLines", () => {
  it("SEC: industry and amount first", () => {
    const lines = evidenceLines({ source: "sec_form_d", country: "United States", founded_year: 2024,
      evidence: { industry_group: "Other Technology", total_offering: 25_000_000, total_sold: 5_000_000,
        officers: [{ name: "Ada", relationships: ["Executive Officer"] }] } });
    expect(lines.slice(0, 2)).toEqual([
      { label: "Industry", value: "Other Technology" },
      { label: "Raising", value: "$25M (sold $5M)" },
    ]);
    expect(lines).toContainEqual({ label: "Related people", value: "Ada (executive officer)" });
  });
  it("UK: SIC codes, directors and company type", () => {
    const lines = evidenceLines({ source: "uk_companies_house", country: "United Kingdom", founded_year: 2026,
      evidence: { codes: ["62012", "62020"], form_type: "ltd",
        officers: [{ name: "A", relationships: ["director"] }, { name: "B", relationships: ["director"] }] } });
    expect(lines).toEqual([
      { label: "SIC codes", value: "62012 62020" },
      { label: "Directors", value: "A (director), B (director)" },
      { label: "Company type", value: "ltd" },
      { label: "Founded", value: "2026" },
      { label: "Country", value: "United Kingdom" },
    ]);
  });
  it("EPO: patent title and a trimmed abstract first, inventors labelled as such", () => {
    const lines = evidenceLines({ source: "epo_ops", country: "United States", founded_year: null,
      evidence: { title: "Robot navigation", abstract: "x".repeat(500), officers: [{ name: "Inv One" }] } });
    expect(lines[0]).toEqual({ label: "Patent", value: "Robot navigation" });
    expect(lines[1].value.length).toBe(401);
    expect(lines).toContainEqual({ label: "Inventors", value: "Inv One" });
  });
  it("skips empty fields instead of showing blanks", () => {
    expect(evidenceLines({ source: "uk_companies_house", country: null, founded_year: null, evidence: {} })).toEqual([]);
  });
});
