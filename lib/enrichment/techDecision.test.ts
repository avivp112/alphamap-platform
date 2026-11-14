import { describe, it, expect } from "vitest";
import { techDecision, type TechGateVerdict } from "./techGate.ts";
import { whyNotEnriched } from "./notEnriched.ts";
import { SECTOR_DEFINITIONS } from "./sectorDefinitions.ts";

const gate = (o: Partial<TechGateVerdict>): TechGateVerdict => ({ is_tech_company: true, confidence: "high", reason: "", enough_information: true, ...o });

// Batch 4, round 3 (owner, 2026-11-13): the profile call turned away energy storage and advanced materials as "not software".
describe("one technology decision from the early check and the profile call", () => {
  it("Hydrostor (energy storage): the early check says technology, the profile call's no cannot turn it away", () => {
    expect(techDecision(gate({ reason: "A-CAES grid storage, climate and energy technology" }), { is_tech_company: false, tech_decision: "not_technology" }, true)).toBe("proceed");
  });
  it("Promethean Particles (advanced materials): same", () => {
    expect(techDecision(gate({ reason: "MOFs, deep tech advanced materials" }), { is_tech_company: false }, true)).toBe("proceed");
  });
  it("MindUP Incubator: a thin early check and a profile that says incubator is a rejection", () => {
    expect(techDecision(gate({ enough_information: false, confidence: "low" }), { is_tech_company: false, tech_decision: "not_technology" }, true)).toBe("reject");
  });
  it("Moft: the early check said no (medium), the profile says a physical consumer product: rejected", () => {
    expect(techDecision(gate({ is_tech_company: false, confidence: "medium" }), { is_tech_company: false, tech_decision: "not_technology" }, true)).toBe("reject");
  });
  it("Ondato IL: the sources say nothing about the company: undetermined, not rejected", () => {
    expect(techDecision(null, { is_tech_company: false, tech_decision: "cannot_tell" }, false)).toBe("undetermined");
    expect(techDecision(gate({ enough_information: false }), { is_tech_company: true }, false)).toBe("undetermined");
  });
  it("a no with nothing known about the company is undetermined, not a rejection", () => {
    expect(techDecision(null, { is_tech_company: false }, false)).toBe("undetermined");
  });
  it("a company the early check did not run for follows the profile call", () => {
    expect(techDecision(null, { is_tech_company: true }, true)).toBe("proceed");
    expect(techDecision(null, { is_tech_company: false }, true)).toBe("reject");
  });
});

describe("undetermined is its own class in the report", () => {
  it("is neither not_technology nor identity_uncertain", () => {
    expect(whyNotEnriched("low_evidence", "technology_undetermined", undefined, "https://x.com")).toBe("technology_undetermined");
  });
});

describe("batch 4 sector rubric", () => {
  it("email for private individuals is consumer, not enterprise; factory robots are industrial automation", () => {
    expect(SECTOR_DEFINITIONS["Productivity & Collaboration"]).toContain("private individuals");
    expect(SECTOR_DEFINITIONS["Industrial Automation"]).toContain("AMR");
    expect(SECTOR_DEFINITIONS["Robotics"]).toContain("Industrial Automation");
  });
});
