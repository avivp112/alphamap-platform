import { describe, it, expect } from "vitest";
import { originFacts } from "./origin";

describe("originFacts", () => {
  it("shows a founding country that differs from the HQ", () => {
    expect(originFacts({ country: "United States", founding_country: "Israel" })).toEqual({ foundedIn: "Israel", rndInIsrael: false });
  });

  it("says nothing the HQ line already says", () => {
    expect(originFacts({ country: "Israel", founding_country: "Israel", israel_rnd_center: true })).toEqual({ foundedIn: null, rndInIsrael: false });
    expect(originFacts({ country: "USA", founding_country: "United States" }).foundedIn).toBeNull();
  });

  it("shows an R&D centre in Israel only for a company headquartered elsewhere", () => {
    expect(originFacts({ country: "United States", israel_rnd_center: true }).rndInIsrael).toBe(true);
    expect(originFacts({ country: null, israel_rnd_center: true }).rndInIsrael).toBe(true);
  });

  it("shows nothing without a value — never inferred", () => {
    expect(originFacts({ country: "United States" })).toEqual({ foundedIn: null, rndInIsrael: false });
    expect(originFacts({ country: "United States", founding_country: "<UNKNOWN>", israel_rnd_center: null })).toEqual({ foundedIn: null, rndInIsrael: false });
    expect(originFacts({})).toEqual({ foundedIn: null, rndInIsrael: false });
  });

  it("shows the founding country when the HQ is unknown", () => {
    expect(originFacts({ country: null, founding_country: "Israel" }).foundedIn).toBe("Israel");
  });
});
