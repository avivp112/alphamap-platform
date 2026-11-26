import { describe, it, expect } from "vitest";
import { componentStates, componentOn, V2_COMPONENT_NAMES } from "./components";

describe("one switch per v2 component (owner, 2026-10-29)", () => {
  it("defaults: off are linkedin_people, profile_hints, bios (2026-11-02/12) and, from the maintenance window (2026-11-23), the Tier 3 collectors: competitors, competitor_tiers, market_compare, founder_background, epo_patents, headcount_archive", () => {
    const s = componentStates("");
    expect(V2_COMPONENT_NAMES.filter((n) => !s[n]).sort()).toEqual(["bios", "competitor_tiers", "competitors", "epo_patents", "founder_background", "headcount_archive", "linkedin_people", "market_compare", "profile_hints"]);
  });
  it("baseline turns every component off, all turns every one on", () => {
    expect(Object.values(componentStates("baseline")).every((v) => !v)).toBe(true);
    expect(Object.values(componentStates("all")).every((v) => v)).toBe(true);
  });
  it("one component changed, alone or on top of baseline", () => {
    expect(componentOn("hints", "hints=off")).toBe(false);
    expect(componentOn("deep_dive", "hints=off")).toBe(true);
    const s = componentStates("baseline,epo_patents=on");
    expect(V2_COMPONENT_NAMES.filter((n) => s[n])).toEqual(["epo_patents"]);
  });
  it("a misspelt setting stops the run rather than measuring the wrong thing", () => {
    expect(() => componentStates("hint=off")).toThrow(/V2_COMPONENTS/);
    expect(() => componentStates("hints=maybe")).toThrow(/V2_COMPONENTS/);
  });
});
