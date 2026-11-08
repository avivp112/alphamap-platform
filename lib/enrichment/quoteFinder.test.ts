import { describe, it, expect } from "vitest";
import { bestSentence, bestQuote } from "./quoteFinder";

const page = "Welcome to Nuova. Nuova predicts supply-chain disruptions for global manufacturers using machine learning. We are hiring in Tel Aviv and London every quarter.";
describe("the sentence of a source that supports a text", () => {
  it("returns the sentence sharing the most words, not the first", () => {
    expect(bestSentence(page, "Nuova predicts supply-chain disruptions for manufacturers")).toBe("Nuova predicts supply-chain disruptions for global manufacturers using machine learning.");
  });
  it("returns null when nothing is close enough", () => {
    expect(bestSentence(page, "payments for restaurants")).toBeNull();
  });
  it("over several sources, the best source wins", () => {
    const r = bestQuote([{ id: "S1", content: "Hiring in London and Tel Aviv every quarter." }, { id: "W1", content: page }], "supply-chain disruptions manufacturers");
    expect(r?.id).toBe("W1");
  });
  it("a sector word alone is enough for a single-word term", () => {
    expect(bestSentence("Our cybersecurity platform protects cloud workloads for large enterprises.", "Cybersecurity")).toMatch(/cybersecurity/i);
  });
});

import { supportedTags } from "./quoteFinder";
describe("tags need a supporting sentence", () => {
  const pages = [{ id: "W1", content: "BrowserStack provides developer teams instant access to a cloud platform for testing websites and mobile applications. Our analytics dashboards show usage." }];
  it("keeps the ones a sentence carries, drops the rest", () => {
    const r = supportedTags(["Developer Tools", "Cybersecurity / General", "Analytics / BI"], pages);
    expect(r.kept.map((k) => k.tag)).toEqual(["Developer Tools", "Analytics / BI"]);
    expect(r.dropped).toEqual(["Cybersecurity / General"]);
  });
});
