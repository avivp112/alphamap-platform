import { describe, it, expect } from "vitest";
import { computeFieldConfidence, meetsProfileThreshold, meetsFundingThreshold, DEFAULT_THRESHOLDS } from "./confidence";

describe("computeFieldConfidence", () => {
  it("no evidence at all scores 0", () => {
    expect(computeFieldConfidence([])).toBe(0);
  });
  it("registry evidence scores 90, regardless of what else is present", () => {
    expect(computeFieldConfidence([{ source_type: "registry" }])).toBe(90);
    expect(computeFieldConfidence([{ source_type: "aggregator_snippet" }, { source_type: "registry" }])).toBe(90);
  });
  it("company_site or press_release scores 75", () => {
    expect(computeFieldConfidence([{ source_type: "company_site" }])).toBe(75);
    expect(computeFieldConfidence([{ source_type: "press_release" }])).toBe(75);
  });
  it("2+ independent news sources agreeing scores 75, same as company_site", () => {
    expect(computeFieldConfidence([{ source_type: "news" }, { source_type: "news" }])).toBe(75);
  });
  it("a single news source scores 55", () => {
    expect(computeFieldConfidence([{ source_type: "news" }])).toBe(55);
  });
  it("aggregator_snippet only scores 40", () => {
    expect(computeFieldConfidence([{ source_type: "aggregator_snippet" }])).toBe(40);
  });
  it("model_inferred only scores 0 -- no real evidence behind it", () => {
    expect(computeFieldConfidence([{ source_type: "model_inferred" }])).toBe(0);
  });
  it("the highest-ranked evidence present wins when several are mixed", () => {
    expect(computeFieldConfidence([{ source_type: "model_inferred" }, { source_type: "news" }, { source_type: "company_site" }])).toBe(75);
  });
});

describe("thresholds", () => {
  it("default profile threshold is 50, funding threshold is 60", () => {
    expect(DEFAULT_THRESHOLDS.minProfileConfidence).toBe(50);
    expect(DEFAULT_THRESHOLDS.minFundingConfidence).toBe(60);
  });
  it("a single-news-sourced field (55) clears the profile bar but not the funding bar", () => {
    const confidence = computeFieldConfidence([{ source_type: "news" }]);
    expect(meetsProfileThreshold(confidence)).toBe(true);
    expect(meetsFundingThreshold(confidence)).toBe(false);
  });
  it("an aggregator-only field (40) clears neither bar", () => {
    const confidence = computeFieldConfidence([{ source_type: "aggregator_snippet" }]);
    expect(meetsProfileThreshold(confidence)).toBe(false);
    expect(meetsFundingThreshold(confidence)).toBe(false);
  });
});
