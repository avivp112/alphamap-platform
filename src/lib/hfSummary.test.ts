import { describe, it, expect } from "vitest";
import { hfHeadline, hfHasTrend, hfOrgUrl, type HfSummary } from "./hfSummary";

const base: HfSummary = { orgs: ["acme"], models: 2, downloads: 2400, downloads_delta_7d: 1400, models_with_delta: 2, likes: 4, top_models: [], weekly: [{ week: "2026-11-02", downloads: 1000 }, { week: "2026-11-09", downloads: 2400 }] };

describe("hf summary", () => {
  it("states downloads and the weekly change", () => {
    expect(hfHeadline(base)).toEqual({ models: "2 models", downloads: "2,400 downloads in the last 30 days", trend: "+1,400 in 7 days" });
  });
  it("says how many models were measured when not all were", () => {
    expect(hfHeadline({ ...base, models_with_delta: 1 }).trend).toBe("+1,400 in 7 days (1 of 2 models measured)");
  });
  it("no trend without a measurement; a drop is shown as a drop", () => {
    expect(hfHeadline({ ...base, downloads_delta_7d: null, models_with_delta: 0 }).trend).toBeNull();
    expect(hfHeadline({ ...base, downloads_delta_7d: -300 }).trend).toBe("−300 in 7 days");
  });
  it("one model is singular; one week is not a trend", () => {
    expect(hfHeadline({ ...base, models: 1 }).models).toBe("1 model");
    expect(hfHasTrend({ ...base, weekly: base.weekly.slice(0, 1) })).toBe(false);
    expect(hfHasTrend(base)).toBe(true);
  });
  it("links to the org page", () => { expect(hfOrgUrl("acme")).toBe("https://huggingface.co/acme"); });
});
