import { describe, it, expect } from "vitest";
import { checkHeadcountClaim, namesCompany } from "./headcount";

const news = { url: "https://techcrunch.com/2024/10/15/gladia-series-a", isCompanySite: false };

describe("checkHeadcountClaim — the Gladia 4 -> 70,000 -> 51 series", () => {
  it("rejects a count of developers/users", () => {
    expect(checkHeadcountClaim(70000, "Gladia serves over 70,000 developers worldwide", news, "Gladia")).toBe("headcount_not_employees");
  });
  it("rejects a dollar figure", () => {
    expect(checkHeadcountClaim(4, "Gladia raised a $4 million seed round led by New Wave", news, "Gladia")).toBe("headcount_not_employees");
  });
  it("rejects either end of a size bracket", () => {
    const src = { url: "https://prospeo.io/c/gladia-revenue", isCompanySite: false };
    expect(checkHeadcountClaim(51, "Software Development • Manhattan, New York • 51-100 Employees.", src, "Gladia")).toBe("headcount_is_range_bound");
    expect(checkHeadcountClaim(200, "Company size 51-200 employees", src, "Gladia")).toBe("headcount_is_range_bound");
  });
  it("rejects a figure on a multi-company list page that never names the company", () => {
    const list = { url: "https://getlatka.com/companies/industries/i-on-demand-wellness-software", isCompanySite: false };
    expect(checkHeadcountClaim(369, "Team size: 369", list, "Glamsquad")).toBe("headcount_not_about_company");
  });
});

describe("checkHeadcountClaim — accepts real employee counts", () => {
  it.each([
    [45, "Apex Space, the 45-person startup, closed a $16 million Series A"],
    [45, "Apex now has 45 employees across two offices"],
    [120, "Apex grew its team of 120 in 2024"],
    [60, "Apex's headcount: 60"],
    [1200, "Apex employs 1,200 people worldwide"],
  ])("%d from %s", (n, quote) => {
    expect(checkHeadcountClaim(n, quote, news, "Apex")).toBeNull();
  });
  it("accepts the company's own page without naming it, and a company-specific profile page", () => {
    expect(checkHeadcountClaim(30, "We are a team of 30 people", { url: "https://apex.com/about", isCompanySite: true }, "Apex")).toBeNull();
    expect(checkHeadcountClaim(369, "Team size: 369", { url: "https://getlatka.com/companies/glamsquad.com", isCompanySite: false }, "Glamsquad")).toBeNull();
  });
});

describe("namesCompany", () => {
  it("matches whole words, accents and URL slugs", () => {
    expect(namesCompany("https://prospeo.io/c/gladia-revenue", "Gladia")).toBe(true);
    expect(namesCompany("Gladiators unite", "Gladia")).toBe(false);
    expect(namesCompany("https://safesuperintelligence.com/about", "Safe Superintelligence")).toBe(true);
    expect(namesCompany("Apex's headcount", "Apex")).toBe(true);
    expect(namesCompany("Safe Superintelligence Inc. raised", "Safe Superintelligence")).toBe(true);
  });
});
