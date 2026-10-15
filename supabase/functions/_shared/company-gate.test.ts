import { describe, it, expect } from "vitest";
import {
  gateUkCompany, gateFormD, gatePatentApplicant, countDirectors, looksLikePerson,
  type UkCompanyInput,
} from "./company-gate";

// Fixtures are the real sample from production (raw_gov_filings, 60 days to
// 2026-10-15) — names, SIC/CPC codes and director counts as ingested.

const directors = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Person ${i}`, relationships: ["director"] }));
const uk = (name: string, sic: string, n = 1, companyType = "ltd"): UkCompanyInput =>
  ({ name, sicCodes: sic.split(" "), companyType, officers: directors(n) });

describe("UK Companies House", () => {
  it("rejects every single-director company in the production sample (24 of 25)", () => {
    const sample: Array<[string, string]> = [
      ["ALEXTGR8DEV LTD", "62011"], ["AVELLANE LIMITED", "62020"], ["CINEMANA PREMIUM LTD", "62012"],
      ["CJ TECH HUB LTD", "63120"], ["EASYSOLVE LIMITED", "62020"], ["ELEMENTAL STRATEGY LTD", "62020 62090 70229"],
      ["EMPLOYEE BENEFIT TECHNOLOGIES LIMITED", "62012 62020"], ["FITEQUANT LTD", "62012"],
      ["GLOBAL AIROBOTICS IMPACT FOUNDATION LIMITED", "62090 73200 74909"], ["HAPTIC MATTER LIMITED", "58290 62012 63120"],
      ["JAMES-FROWN HOLDINGS LTD", "58290 62020 64209 82990"], ["KAGHAZ LESS LTD", "58290 62012 62090"],
      ["LEXPAR GROUP LTD", "62012 63110"], ["MAKETHATTWO LTD", "63120"], ["MISSION COMMAND DYNAMICS LIMITED", "62012 62020 72190 74909"],
      ["PADOOKI LTD", "58210 62011"], ["PROJECT50CHALLENGE LTD", "47910 62012"], ["ROOKWILD LTD", "62012"],
      ["SEMIDEX LIMITED", "62012"], ["SONNEL LTD", "58290 62012"], ["SYSROL TECH LIMITED", "62020 62030 62090"],
      ["TOZ INDUSTRIES LTD", "58290 62012 62020"], ["UNOVIC STRATEGIC PARTNERS LIMITED", "62020 70229"], ["WCLOUD LTD", "63110"],
    ];
    for (const [name, sic] of sample) {
      const r = gateUkCompany(uk(name, sic, 1));
      expect(r.tier, name).toBe("reject");
      expect(r.reasons, name).toContain("single_director");
    }
  });

  it("alerts on a product company with a founding team (IDMON: 2 directors, software development)", () => {
    expect(gateUkCompany(uk("IDMON LIMITED", "62012 62020", 2))).toEqual({ tier: "alert", reasons: [] });
  });

  // The rules below are checked with a 2-director team, so each one is shown to reject on its own.
  it("rejects a services-only company (IT contracting), even with a team", () => {
    expect(gateUkCompany(uk("AVELLANE LIMITED", "62020", 2)).reasons).toEqual(["service_codes_only"]);
    expect(gateUkCompany(uk("SYSROL TECH LIMITED", "62020 62030 62090", 2)).reasons).toEqual(["service_codes_only"]);
  });

  it("rejects holding, consultancy and retail SIC codes alongside product codes", () => {
    expect(gateUkCompany(uk("ACME AI LTD", "62012 64209", 2)).reasons).toEqual(["blocked_sic:64209 holding company"]);
    expect(gateUkCompany(uk("ACME AI LTD", "62012 70229", 2)).reasons).toEqual(["blocked_sic:70229 management consultancy"]);
    expect(gateUkCompany(uk("PROJECT50CHALLENGE LTD", "47910 62012", 2)).reasons).toEqual(["blocked_sic:47910 online retail"]);
  });

  // Found by the full dry run (2026-10-15): companies that had added 62012 to a non-tech business.
  it("rejects whole non-tech sectors even alongside a software code", () => {
    const sector = (name: string, sic: string) => gateUkCompany(uk(name, sic, 2)).reasons;
    expect(sector("VISTARA GLOBAL LTD", "46210 46310 46900 62012")).toContain("blocked_sic:46210 wholesale / retail trade");
    expect(sector("SHROOM ME UP LTD", "10840 72110")).toEqual(["blocked_sic:10840 food & drink manufacturing"]);
    expect(sector("SHAKIL UK LIMITED", "62012 73110 79120 85600")).toEqual(expect.arrayContaining([
      "blocked_sic:73110 advertising", "blocked_sic:79120 travel", "blocked_sic:85600 tutoring / training"]));
    expect(sector("TWO PLUS THREE LIMITED", "58110 59112 62012 74100")).toEqual(["blocked_sic:58110 print publishing"]);
    expect(sector("AMAVOLA LTD", "59112 62012 63120 73110")).toEqual(["blocked_sic:73110 advertising"]);
    // 58290 is software publishing — not print, stays allowed
    expect(gateUkCompany(uk("NUOVA AI LTD", "58290 62012", 2)).tier).toBe("alert");
  });

  it("rejects group / ventures / family names (holding structures at incorporation)", () => {
    expect(gateUkCompany(uk("INTHEKNOW GROUP LIMITED", "63120", 2)).reasons).toEqual(["name:group"]);
    expect(gateUkCompany(uk("TWIN PALM VENTURES LTD", "62011 62012", 2)).reasons).toEqual(["name:ventures"]);
    expect(gateUkCompany(uk("HENDERSON AJ & FAMILY LTD", "62012", 2)).reasons).toEqual(["name:family"]);
  });

  it("rejects shell and consultancy names", () => {
    expect(gateUkCompany(uk("JAMES-FROWN HOLDINGS LTD", "62012", 2)).reasons).toEqual(["name:holdings"]);
    expect(gateUkCompany(uk("UNOVIC STRATEGIC PARTNERS LIMITED", "62012", 2)).reasons).toEqual(["name:strategic"]);
    expect(gateUkCompany(uk("GLOBAL AIROBOTICS IMPACT FOUNDATION LIMITED", "62012", 2)).reasons).toEqual(["name:foundation"]);
    expect(gateUkCompany(uk("NORTHSTAR IT SERVICES LTD", "62012", 2)).reasons).toEqual(["name:services"]);
  });

  it("does not match blocked words inside other words", () => {
    // "trust" inside "TRUSTLESS", "capital" inside "CAPITALISE" — whole words only.
    expect(gateUkCompany(uk("TRUSTLESS LABS LTD", "62012", 2)).tier).toBe("alert");
  });

  it("rejects non-share company types (guarantee, LLP)", () => {
    expect(gateUkCompany(uk("OPEN DATA COLLECTIVE", "62012", 2, "private-limited-guarant-nsc")).reasons)
      .toEqual(["company_type:private-limited-guarant-nsc"]);
    expect(gateUkCompany(uk("ACME AI", "62012", 2, "llp")).reasons).toEqual(["company_type:llp"]);
  });

  it("rejects when officers are unknown rather than guessing", () => {
    expect(gateUkCompany({ name: "ACME AI LTD", sicCodes: ["62012"], companyType: "ltd", officers: [] }).reasons)
      .toEqual(["no_officer_data"]);
  });

  it("counts only natural-person directors", () => {
    expect(countDirectors([
      { relationships: ["director"] }, { relationships: ["corporate-director"] },
      { relationships: ["nominee-director"] }, { relationships: ["llp-member"] },
    ])).toBe(1);
    // corporate director + 1 real director is still a one-person company
    expect(gateUkCompany({ name: "ACME AI LTD", sicCodes: ["62012"], companyType: "ltd",
      officers: [{ relationships: ["director"] }, { relationships: ["corporate-director"] }] }).reasons).toEqual(["single_director"]);
  });

  it("lists every failing rule, not just the first", () => {
    const r = gateUkCompany(uk("JAMES-FROWN HOLDINGS LTD", "58290 62020 64209 82990", 1));
    expect(r.reasons).toEqual(expect.arrayContaining([
      "blocked_sic:64209 holding company", "blocked_sic:82990 business support services", "name:holdings", "single_director",
    ]));
  });
});

describe("SEC Form D", () => {
  it("alerts on both production samples — companies actually raising", () => {
    expect(gateFormD({ name: "Advisory List, Inc.", industryGroup: "Other Technology" }).tier).toBe("alert");
    expect(gateFormD({ name: "APR Labs Inc.", industryGroup: "Other Technology" }).tier).toBe("alert");
  });

  it("rejects investment vehicles that pass the industry filter", () => {
    for (const name of [
      "Series 12, a series of Acme Ventures LLC", "Acme AI SPV I, LLC", "Frontier Opportunity Fund LP",
      "Acme Co-Invest Vehicle LLC", "XYZ Capital Partners II", "Acme Technology Investors LLC",
    ]) expect(gateFormD({ name, industryGroup: "Other Technology" }).tier, name).toBe("reject");
  });

  it("rejects an equities vehicle (Crafton Equities Inc., full dry run)", () => {
    expect(gateFormD({ name: "Crafton Equities Inc.", industryGroup: "Other Technology" }).reasons).toEqual(["vehicle_name:equities"]);
  });

  it("rejects funds and out-of-scope industries", () => {
    expect(gateFormD({ name: "Acme Inc.", industryGroup: "Pooled Investment Fund", isFund: true }).reasons)
      .toEqual(["investment_fund", "industry:Pooled Investment Fund"]);
    expect(gateFormD({ name: "Acme Inc.", industryGroup: "Real Estate" }).reasons).toEqual(["industry:Real Estate"]);
  });
});

describe("EPO patent applicants", () => {
  it("never alerts — the review queue decides", () => {
    for (const name of ["Field AI, Inc.", "Voxela, Inc", "SmartSceneAI, LLC", "Lux Mind Co., Ltd.", "GreenFish hf."]) {
      expect(gatePatentApplicant({ name, excluded: false }), name).toEqual({ tier: "queue", reasons: [] });
    }
  });

  it("rejects private inventors from the production sample", () => {
    expect(gatePatentApplicant({ name: "Park Jonghyun", excluded: false }).reasons).toEqual(["individual_applicant"]);
    expect(gatePatentApplicant({ name: "Perez Michael Arthur", excluded: false }).reasons).toEqual(["individual_applicant"]);
    expect(gatePatentApplicant({ name: "Anna Smith (inventor-held)", excluded: false }).reasons).toEqual(["no_company_applicant"]);
  });

  it("rejects denylisted incumbents and institutions", () => {
    expect(gatePatentApplicant({ name: "Disney Enterprises, Inc.", excluded: true }).reasons).toEqual(["excluded_applicant"]);
    expect(gatePatentApplicant({ name: "University of Cambridge", excluded: false }).reasons).toEqual(["institution"]);
    expect(gatePatentApplicant({ name: "Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e.V.", excluded: false }).reasons)
      .toEqual(["institution"]);
  });

  it("rejects incumbents' IP and operating subsidiaries, governments and partnerships (full dry run)", () => {
    for (const name of [
      "Microsoft Technology Licensing, LLC", "Ford Global Technologies, LLC", "GM Global Technology Operations LLC",
      "Intrinsic Innovation LLC", "Cerner Innovation, Inc.", "Avago Technologies International Sales Pte. Limited",
      "Camelot UK Bidco Limited", "OpenAI OpCo, LLC", "Core Scientific Operating Company", "Walmart Apollo, LLC",
      "Tuhui Shengchuang Enterprise Management (Suzhou) Partnership (Limited Partnership)",
    ]) expect(gatePatentApplicant({ name, excluded: false }).reasons, name).toContain("corporate_ip_vehicle");
    expect(gatePatentApplicant({ name: "Government of the United States, as represented by the Secretary of the Air Force", excluded: false }).reasons)
      .toEqual(["institution"]);
    // a startup whose name merely contains "Innovation" is not caught
    expect(gatePatentApplicant({ name: "Hunt Innovative Technologies, L.L.C.", excluded: false }).tier).toBe("queue");
  });

  it("knows company forms it missed in the full dry run", () => {
    expect(gatePatentApplicant({ name: "ExtensityAI FlexCo", excluded: false }).tier).toBe("queue");  // Austrian FlexCo
    expect(looksLikePerson("Toshiba Tec Kabushiki Kaisha")).toBe(false);
    expect(looksLikePerson("IDEMIA PUBLIC SECURITY FRANCE")).toBe(false);   // all-caps, 4 words: an organisation
    expect(looksLikePerson("HOSSEINZADEH TAHER Mohammad Reza")).toBe(true);
    expect(looksLikePerson("GHOSH Ashish")).toBe(true);
  });

  it("tells people from organisations", () => {
    expect(looksLikePerson("Park Jonghyun")).toBe(true);
    expect(looksLikePerson("Field AI, Inc.")).toBe(false);
    expect(looksLikePerson("Neural Robotics")).toBe(false);
    expect(looksLikePerson("GreenFish hf.")).toBe(false);
  });
});
