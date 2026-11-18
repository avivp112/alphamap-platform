import { describe, it, expect } from "vitest";
import {
  officerAppointmentsSignals, pscSignals, parseCapitalEvents, capitalSignals, sharedAddressSignals,
  previousRaiseSignals, formDPersonSignals, MANY_DIRECTORSHIPS, type KnownCompanies,
} from "./candidate-signals";

const appt = (n: string, name: string, status = "active", resigned?: string, role = "director") =>
  ({ appointed_to: { company_number: n, company_name: name, company_status: status }, officer_role: role, ...(resigned ? { resigned_on: resigned } : {}) });
const none: KnownCompanies = new Map();

describe("officerAppointmentsSignals", () => {
  it("ignores the company itself and reports other active directorships", () => {
    const s = officerAppointmentsSignals("BLOGGS, Jo", { items: [appt("1", "THIS LTD"), appt("2", "OTHER ONE LTD"), appt("3", "OLD LTD", "active", "2024-01-01")] }, "1", none, "/officers/x/appointments");
    expect(s).toEqual([{ kind: "serial_founder", level: "positive", url: "https://find-and-update.company-information.service.gov.uk/officers/x/appointments",
      text: "BLOGGS, Jo: 1 other active directorship (OTHER ONE LTD)" }]);
  });
  it("a sole appointment gives no signal", () => {
    expect(officerAppointmentsSignals("A", { items: [appt("1", "THIS LTD")] }, "1", none)).toEqual([]);
  });
  it("flags dozens of directorships as a warning, not a serial founder", () => {
    const items = [appt("1", "THIS"), ...Array.from({ length: MANY_DIRECTORSHIPS }, (_, i) => appt(String(100 + i), `C${i}`))];
    const s = officerAppointmentsSignals("A", { items }, "1", none);
    expect(s.map((x) => [x.kind, x.level])).toEqual([["many_directorships", "warning"]]);
  });
  it("links a company already in AlphaMap and counts dissolved ones", () => {
    const known: KnownCompanies = new Map([["2", { id: "u1", name: "Acme AI" }]]);
    const s = officerAppointmentsSignals("A", { items: [appt("2", "ACME AI LTD", "active", undefined, "director"), appt("3", "GONE LTD", "dissolved", "2023-01-01")] }, "1", known);
    expect(s.map((x) => x.kind)).toEqual(["serial_founder", "known_company_link", "dissolved_history"]);
    expect(s[1].text).toBe("A is also director of Acme AI, which is in AlphaMap");
  });
  it("a null payload is no signal", () => { expect(officerAppointmentsSignals("A", null, "1", none)).toEqual([]); });
});

describe("pscSignals", () => {
  const corp = (name: string, reg?: string, ceased?: string) =>
    ({ kind: "corporate-entity-person-with-significant-control", name, identification: reg ? { registration_number: reg } : {}, ...(ceased ? { ceased_on: ceased } : {}) });
  it("separates a known company, an investor name, and a holding company", () => {
    const known: KnownCompanies = new Map([["777", { id: "u", name: "ParentCo" }]]);
    const s = pscSignals({ items: [
      { kind: "individual-person-with-significant-control", name: "A B" },
      corp("PARENT LTD", "777"), corp("NORTH VENTURES LLP"), corp("SMITH FAMILY HOLDINGS LTD"), corp("OLD OWNER LTD", "9", "2025-01-01"),
    ] }, known, "1");
    expect(s.map((x) => [x.kind, x.level])).toEqual([
      ["psc_summary", "info"], ["known_company_psc", "positive"], ["investor_psc", "positive"], ["holding_psc", "warning"],
    ]);
  });
  it("no active PSC, no signal", () => { expect(pscSignals({ items: [corp("X", "1", "2025-01-01")] }, none, "1")).toEqual([]); });
});

describe("capital filings", () => {
  const payload = { items: [
    { type: "SH01", date: "2026-10-20", description_values: { capital: [{ figure: "1,200", currency: "GBP" }] } },
    { type: "AA", date: "2026-09-01" },
    { type: "SH01", date: "2026-08-02" },
  ] };
  it("lists SH01 events newest first with the capital figure when given", () => {
    expect(parseCapitalEvents(payload)).toEqual([{ type: "SH01", date: "2026-10-20", capital: "1,200 GBP" }, { type: "SH01", date: "2026-08-02" }]);
  });
  it("one signal summarising them", () => {
    expect(capitalSignals(payload, "1")[0].text).toBe("2 share allotments filed: 2026-10-20 (capital after: 1,200 GBP); 2026-08-02");
    expect(capitalSignals({ items: [] }, "1")).toEqual([]);
  });
});

describe("shared address", () => {
  it("warns from the threshold up", () => {
    expect(sharedAddressSignals(4, "x")).toEqual([]);
    expect(sharedAddressSignals(5, "x")[0].level).toBe("warning");
    expect(sharedAddressSignals(9, null)).toEqual([]);
  });
});

describe("Form D", () => {
  it("previous raises need two original offerings; amendments do not count", () => {
    expect(previousRaiseSignals([{ form_type: "D", filing_date: "2026-01-01" }, { form_type: "D/A", filing_date: "2026-02-01" }], "123")).toEqual([]);
    const s = previousRaiseSignals([{ form_type: "D", filing_date: "2026-11-01" }, { form_type: "D", filing_date: "2025-05-01" }], "123");
    expect(s[0].text).toBe("2 Form D offerings filed since 2025-05-01");
  });
  it("person signals: other issuers and fund manager", () => {
    const s = formDPersonSignals("Dana Okonkwo", [{ entity_name: "Beta Inc" }, { entity_name: "Beta Inc" }], [{ fund_name: "North Ventures IV, L.P.", firm_name: "North", fund_type: "Venture Capital Fund" }]);
    expect(s.map((x) => x.kind)).toEqual(["person_prior_form_d", "person_fund_manager"]);
    expect(s[0].text).toBe("Dana Okonkwo (same name) is also a related person on Form D of Beta Inc");
    expect(formDPersonSignals("X", [], [])).toEqual([]);
  });
});
