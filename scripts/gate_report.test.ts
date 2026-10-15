import { describe, it, expect } from "vitest";
import { gateFiling, companyTiers, type FilingRow } from "./gate_report";

const row = (over: Partial<FilingRow>): FilingRow => ({
  source: "uk_companies_house", entity_name: "ACME AI LTD", form_type: "ltd", classification_codes: ["62012"],
  officers: [{ relationships: ["director"] }, { relationships: ["director"] }], industry_group: null,
  startup_id: "s1", startups: null, ...over,
});

describe("gate_report", () => {
  it("routes each source to its gate", () => {
    expect(gateFiling(row({}), new Set()).tier).toBe("alert");
    expect(gateFiling(row({ source: "sec_form_d", entity_name: "Acme SPV I LLC", industry_group: "Other Technology" }), new Set()).tier).toBe("reject");
    expect(gateFiling(row({ source: "epo_ops", entity_name: "Field AI, Inc." }), new Set()).tier).toBe("queue");
    expect(gateFiling(row({ source: "epo_ops", entity_name: "Disney Enterprises, Inc." }), new Set(["Disney Enterprises, Inc."])).tier).toBe("reject");
    expect(gateFiling(row({ source: "something_new" }), new Set()).tier).toBe("reject");
  });

  it("a company created from several patents keeps its best verdict", () => {
    const t = companyTiers([
      { startup_id: "a", result: { tier: "reject", reasons: ["individual_applicant"] } },
      { startup_id: "a", result: { tier: "queue", reasons: [] } },
      { startup_id: "b", result: { tier: "reject", reasons: ["excluded_applicant"] } },
      { startup_id: null, result: { tier: "alert", reasons: [] } },
    ]);
    expect(Object.fromEntries(t)).toEqual({ a: "queue", b: "reject" });
  });
});
