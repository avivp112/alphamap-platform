import { describe, it, expect } from "vitest";
import { sanitizeModelOutput } from "./sanitize";

describe("sanitizeModelOutput", () => {
  it("drops sentinel placeholder strings", () => {
    expect(sanitizeModelOutput("unknown")).toBeUndefined();
    expect(sanitizeModelOutput("N/A")).toBeUndefined();
    expect(sanitizeModelOutput("—")).toBeUndefined();
  });
  it("recovers a field that came back as a stringified JSON array", () => {
    const result = sanitizeModelOutput('[{"round_type":"Series A","amount_raised":16000000}]');
    expect(result).toEqual([{ round_type: "Series A", amount_raised: 16_000_000 }]);
  });
  it("drops an unparseable stringified-JSON-looking value rather than passing it through raw", () => {
    expect(sanitizeModelOutput("[this is not valid json")).toBeUndefined();
  });
  it("recursively cleans nested objects and arrays, dropping only the sentinel leaves", () => {
    const input = {
      profile: { city: "London", country: "unknown" },
      founders: [{ name: "Jane Doe", linkedin_url: "n/a" }],
    };
    expect(sanitizeModelOutput(input)).toEqual({
      profile: { city: "London" },
      founders: [{ name: "Jane Doe" }],
    });
  });
  it("passes a normal value straight through", () => {
    expect(sanitizeModelOutput(42)).toBe(42);
    expect(sanitizeModelOutput("London")).toBe("London");
    expect(sanitizeModelOutput(true)).toBe(true);
  });
});
