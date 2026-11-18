import { describe, it, expect } from "vitest";
import { roleAtCompany } from "./people";
describe("roleAtCompany (owner, batch 7)", () => {
  it("a second role after the comma is not another company", () => {
    for (const t of ["Co-Founder, Chief Executive Officer", "Founder, Chief Executive Officer & Co-Founder", "Co-founder, CTO", "Co-founder, Chief AI Officer"]) {
      expect(roleAtCompany(t, "Inipharm").role, t).not.toBeNull();
    }
  });
  it("a real other company still is", () => {
    expect(roleAtCompany("Founder, Sisense", "Inipharm").role).toBeNull();
    expect(roleAtCompany("Co-Founder & Chief Product Officer at Churnkey", "Uxcel").role).toBeNull();
  });
});
