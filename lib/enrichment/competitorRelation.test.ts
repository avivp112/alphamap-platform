import { describe, it, expect } from "vitest";
import { competitorRelation } from "./competitorRelation";

describe("a partner or a host platform is not a competitor (run of 2026-10-26)", () => {
  it("drops Twist Bioscience for Biotia — 'partners with Biotia'", () => {
    expect(competitorRelation("Twist Bioscience",
      "Twist Bioscience partners with Biotia to provide sequencing-based diagnostic solutions. Both companies develop genetic variant detection and reporting capabilities for infectious diseases.",
      "Biotia, Inc.")).toBe("competitor_is_partner");
  });

  it("drops Index Exchange for Chalice — Chalice's models run inside it", () => {
    expect(competitorRelation("Index Exchange",
      "Index Exchange is an SSP (supply-side platform) that competes with Chalice's containerized RTB approach. Zillow piloted Chalice's custom AI models embedded within Index Exchange's infrastructure, showing how Chalice's intelligence can be integrated into SSP platforms.",
      "Chalice Custom Algorithms, Inc.")).toBe("competitor_is_partner");
  });

  it("drops a customer or an investor", () => {
    expect(competitorRelation("Mayo Clinic", "Mayo Clinic is a customer of Biotia, using its urine test in clinical studies.", "Biotia, Inc.")).toBe("competitor_is_partner");
    expect(competitorRelation("SK Square", "SK Square invested in Biotia's Series A and operates diagnostics ventures in Korea.", "Biotia, Inc.")).toBe("competitor_is_partner");
  });

  it("keeps real competitors — including ones that partner with others", () => {
    expect(competitorRelation("Ring",
      "Ring manufactures video doorbells and entry management devices for home security. 1AHEAD Technologies' GLO product directly competes with Ring as an AI-driven entry management device.",
      "1AHEAD Technologies")).toBeNull();
    expect(competitorRelation("E Ink Corporation",
      "E Ink Corporation develops display technology for reflective displays. It competes with Azumo's LCD 2.0 in the market for low-power, sunlight-readable displays.",
      "Azumo, Inc.")).toBeNull();
    expect(competitorRelation("Archer Aviation",
      "Archer Aviation develops eVTOL aircraft and partners with United Airlines on air taxi routes, competing with BETA in the eVTOL market.",
      "BETA AIR LLC")).toBeNull();
  });
});
