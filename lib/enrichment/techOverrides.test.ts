import { describe, it, expect } from "vitest";
import { techOverride } from "./techOverrides";
describe("tech overrides (owner, round 10)", () => {
  it("matches the owner's list by folded name", () => {
    expect(techOverride("noo.ma")).not.toBeNull();
    expect(techOverride("ALUS Canada")).not.toBeNull();
    expect(techOverride("Studio  Feixen")).not.toBeNull();
    expect(techOverride("plott")).not.toBeNull();
  });
  it("leaves every other company alone", () => {
    expect(techOverride("Plotly")).toBeNull();
    expect(techOverride("Routing Number Inc")).toBeNull();
  });
});
