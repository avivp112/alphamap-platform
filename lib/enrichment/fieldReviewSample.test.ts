import { describe, it, expect } from "vitest";
import { capPerCompany } from "./fieldReview";

describe("the marking sample (owner, 2026-11-04)", () => {
  it("at most 2 values of one company in a field", () => {
    const xs = [..."aaaaab"].map((c, i) => ({ company_id: c, i }));
    expect(capPerCompany(xs, 2).map((x) => x.company_id)).toEqual(["a", "a", "b"]);
  });
});
