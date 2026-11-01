import { describe, it, expect } from "vitest";
import { officesLabel } from "./offices";

describe("offices shown when no headquarters is declared (Aidoc, owner 2026-11-01)", () => {
  it("lists the cities once, in order", () => {
    expect(officesLabel([{ city: "New York", country: "United States" }, { city: "Tel Aviv", country: "Israel" }, { city: "New York" }])).toBe("New York, Tel Aviv");
    expect(officesLabel([])).toBeNull();
    expect(officesLabel(null)).toBeNull();
  });
});
