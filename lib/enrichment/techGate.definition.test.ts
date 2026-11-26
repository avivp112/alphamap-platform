import { describe, it, expect } from "vitest";
import { TECH_DEFINITION, buildTechGateRequest } from "./techGate.ts";

describe("the definition of a technology company (owner, 2026-11-13)", () => {
  it("names the categories that were wrongly turned away", () => {
    for (const w of ["energy storage", "advanced materials", "vertical farming", "marketplace"]) expect(TECH_DEFINITION).toContain(w);
  });
  it("names what is not technology", () => {
    for (const w of ["design or creative studios", "non-profits", "incubators", "consumer products"]) expect(TECH_DEFINITION).toContain(w);
  });
  it("is the definition the early check asks with", () => {
    const req = buildTechGateRequest("Hydrostor", "grid-scale energy storage", null, null);
    expect(req.messages[0].content).toContain(TECH_DEFINITION);
    expect(JSON.stringify(req.tools)).toContain("energy storage");
  });
});
