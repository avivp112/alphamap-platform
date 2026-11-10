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
  const pages = [{ id: "W1", content: "BrowserStack provides developer tools and instant access to a cloud platform for testing websites and mobile applications. Our analytics dashboards show usage." }];
  it("keeps the ones a sentence carries, drops the rest", () => {
    const r = supportedTags(["Developer Tools", "Cybersecurity / General", "Analytics / BI"], pages);
    expect(r.kept.map((k) => k.tag)).toEqual(["Developer Tools", "Analytics / BI"]);
    expect(r.dropped).toEqual(["Cybersecurity / General"]);
  });
});

describe("a tag needs its own words close together (review 8, 2026-11-10)", () => {
  it("Cloud Security is not 'a cloud-based platform … vehicle security'; Enterprise Software is not 'enterprise customers'", () => {
    const upstream = [{ id: "S1", content: "Upstream's platform is entirely cloud-based and seamlessly ingests and normalizes automotive data to deliver cybersecurity insights that ensure vehicle security and safety is never compromised." }];
    expect(supportedTags(["Cloud Security"], upstream).kept).toEqual([]);
    expect(supportedTags(["Enterprise Software"], [{ id: "S2", content: "The majority of the business is now focused on delivering answers to enterprise customers who subscribe to the data." }]).kept).toEqual([]);
  });
  it("the product that is cloud security, or enterprise software, is kept", () => {
    expect(supportedTags(["Cloud Security"], [{ id: "S1", content: "Wiz sells a cloud security platform that finds risks across cloud environments." }]).kept.map((k) => k.tag)).toEqual(["Cloud Security"]);
    expect(supportedTags(["Fintech / General"], [{ id: "S3", content: "Sedric is an AI-based compliance platform for next-gen fintech companies and banks." }]).kept.map((k) => k.tag)).toEqual(["Fintech / General"]);
  });
  it("a page that says nothing was found supports nothing (SuperMeat)", () => {
    expect(supportedTags(["Industrial & Manufacturing"], [{ id: "S4", content: "It looks like nothing was found at this location. Manufacturing | Our Meat | Press | Contact us. Industrial and manufacturing partners welcome." }]).kept).toEqual([]);
  });
});

import { isErrorPage } from "./quoteFinder";
describe("an error page supports nothing (review 6, 2026-11-08: Armorblox)", () => {
  const blocked = "Source: Business Wire — Date: 42 months ago — Armorblox today announced its newest product, Graymail and Recon Attack Protection, developed to decrease the time security teams spend... [Full article text] Warning: Target URL returned error 403: Forbidden * * * Please be advised that this page is unavailable.";
  it("is recognised, and no tag or description is quoted from it", () => {
    expect(isErrorPage(blocked)).toBe(true);
    expect(isErrorPage("Armorblox protects email with data security and AI.")).toBe(false);
    expect(supportedTags(["Data Security"], [{ id: "S1", content: blocked }]).kept).toEqual([]);
  });
});
