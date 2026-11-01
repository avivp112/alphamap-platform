import { describe, it, expect } from "vitest";
import { countryFilterOr } from "./countryFilter";

describe("a country lists HQ, offices and founding country (owner, 2026-11-01)", () => {
  it("Israel matches the HQ, an office or the founding country — Aidoc (offices in Tel Aviv), HiBob (founded in Tel Aviv)", () => {
    expect(countryFilterOr("Israel")).toBe('country.ilike.Israel,founding_country.ilike.Israel,office_countries.cs.{"Israel"}');
  });
  it("every country, the same way; a name with a space is quoted", () => {
    expect(countryFilterOr("United States")).toBe('country.ilike.United States,founding_country.ilike.United States,office_countries.cs.{"United States"}');
    expect(countryFilterOr("")).toBeNull();
  });
});
