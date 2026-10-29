import { describe, it, expect } from "vitest";
import { countryFilterOr } from "./countryFilter";

describe("the Israel filter includes companies founded in Israel (owner, 2026-10-29)", () => {
  it("Israel matches the HQ or the founding country — HiBob (HQ London, founded in Tel Aviv) is listed", () => {
    expect(countryFilterOr("Israel")).toBe("country.ilike.Israel,founding_country.ilike.Israel");
  });
  it("other countries filter on the HQ only", () => {
    expect(countryFilterOr("United States")).toBeNull();
    expect(countryFilterOr("")).toBeNull();
  });
});
