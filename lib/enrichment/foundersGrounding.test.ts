import { describe, it, expect } from "vitest";
import { groundFounders, sentenceGroundsFounder } from "./people";

// The funding announcement shape that put six angels in Huskeys' founders (2026-10-18).
const announcement = {
  url: "https://www.thesaasnews.com/news/huskeys-lands-8-million-seed-round",
  title: "Huskeys Lands $8 Million Seed Round",
  content: "Huskeys, founded in 2025 by Itai Gafni and Roy Weisfeld, raised an $8 million seed round led by 10D. " +
    "The round included angel investors Ofer Ben-Noon, co-founder of Talon, Slavik Markovich, co-founder and CEO of Descope, " +
    "Rishi Bhargava, co-founder of Demisto, and Tzahi Weisfeld, founder of Microsoft for Startups Israel.",
};
const ownTeamPage = { url: "https://huskeys.io/team", source_type: "company_site", content: "Itai Gafni - Co-Founder & CEO\nRoy Weisfeld — Co-Founder & CTO" };
const extracted = ["Tzahi Weisfeld", "Ofer Ben Noon", "Slavik Markovich", "Rishi Bhargava", "Itai Gafni", "Roy Weisfeld"].map((name) => ({ name }));

describe("groundFounders", () => {
  it("keeps the founders the sources name; drops the angels introduced as founders of other companies", () => {
    const r = groundFounders(extracted, [announcement], "Huskeys", []);
    expect(r.kept.map((f) => f.name)).toEqual(["Itai Gafni", "Roy Weisfeld"]);
    expect(r.dropped.map((d) => d.name).sort()).toEqual(["Ofer Ben Noon", "Rishi Bhargava", "Slavik Markovich", "Tzahi Weisfeld"]);
  });
  it("anyone in the round's investor list is never a founder", () => {
    const r = groundFounders(extracted, [announcement, ownTeamPage], "Huskeys", ["10D", "Ofer Ben-Noon", "Slavik Markovich"]);
    expect(r.dropped.filter((d) => d.reason === "founder_is_investor").map((d) => d.name)).toEqual(["Ofer Ben Noon", "Slavik Markovich"]);
  });
  it("the company's own team page grounds its founders", () => {
    expect(groundFounders([{ name: "Roy Weisfeld" }], [ownTeamPage], "Huskeys", []).kept).toHaveLength(1);
  });
  it("a founder no source states is dropped, not guessed", () => {
    expect(groundFounders([{ name: "Dana Levi" }], [announcement], "Huskeys", []).dropped).toEqual([{ name: "Dana Levi", reason: "founder_not_grounded" }]);
  });
});

describe("sentenceGroundsFounder", () => {
  it("the usual ways a founder is stated", () => {
    expect(sentenceGroundsFounder("Huskeys co-founder and CEO Itai Gafni said the round will fund hiring.", "Itai Gafni", "Huskeys", false)).toBe(true);
    expect(sentenceGroundsFounder("Itai Gafni, who co-founded Huskeys in 2025, previously led security at Wiz.", "Itai Gafni", "Huskeys", false)).toBe(true);
    expect(sentenceGroundsFounder("Roy Weisfeld is a co-founder of Huskeys.", "Roy Weisfeld", "Huskeys", false)).toBe(true);
  });
  it("founder of another company, an investor word in between, or a sentence not about the company: no", () => {
    expect(sentenceGroundsFounder("Huskeys hired Lior Tal, co-founder of Guardium, as an advisor.", "Lior Tal", "Huskeys", false)).toBe(false);
    expect(sentenceGroundsFounder("Huskeys founders were joined by angel investor Etay Bogner.", "Etay Bogner", "Huskeys", false)).toBe(false);
    expect(sentenceGroundsFounder("Etay Bogner co-founded Meta Networks.", "Etay Bogner", "Huskeys", false)).toBe(false);
  });
});
