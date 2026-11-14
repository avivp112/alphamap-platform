import { describe, it, expect } from "vitest";
import { dateByPrecision } from "./writeCompany.ts";

describe("a round's date in the report, as far as the source states it (owner, 2026-11-14)", () => {
  it("year only shows the year, not 1 January", () => {
    expect(dateByPrecision("2024-01-01", "year")).toBe("2024 (year only)");
    expect(dateByPrecision("2024-03-01", "month")).toBe("2024-03 (month only)");
    expect(dateByPrecision("2024-03-17", "day")).toBe("2024-03-17");
    expect(dateByPrecision("2024-03-17", null)).toBe("2024-03-17");
    expect(dateByPrecision(null, "day")).toBe("no date");
  });
});
