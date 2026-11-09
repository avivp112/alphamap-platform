import { describe, it, expect } from "vitest";
import { processDescription, sentenceProblem, claims, MARKETING } from "./descriptionBuilder";

const site = "Nuova predicts supply-chain disruptions for global manufacturers using machine learning on shipping and supplier data. Customers include automotive and electronics manufacturers in Europe. Nuova was founded in 2022 and has 45 employees.";
const byId = { W1: { content: site }, S1: { content: "Acme Capital invested in Nuova. The startup raised $8 million in a seed round." } };
const ok = (id: string) => id !== "S9";
const S = (role: string, text: string, ids = ["W1"]) => ({ role, text, source_ids: ids });

describe("sentences are checked against their own sources", () => {
  it("accepts a plain sentence its source supports", () => {
    expect(sentenceProblem(S("what", "Nuova predicts supply-chain disruptions for global manufacturers using machine learning."), "Nuova", byId, ok)).toBeNull();
  });
  it("rejects a marketing word, however true", () => {
    expect(sentenceProblem(S("what", "Nuova is a leading provider that predicts supply-chain disruptions for manufacturers."), "Nuova", byId, ok)).toBe("marketing_word");
    expect(MARKETING.test("AI-native platform")).toBe(true);
  });
  it("a number or a name that is not in the cited sources kills the sentence", () => {
    expect(sentenceProblem(S("for_whom", "Nuova serves 300 automotive manufacturers in Europe."), "Nuova", byId, ok)).toMatch(/^number_not_in_sources:300/);
    expect(sentenceProblem(S("for_whom", "Nuova serves automotive manufacturers such as Siemens."), "Nuova", byId, ok)).toMatch(/^name_not_in_sources:Siemens/);
    expect(sentenceProblem(S("for_whom", "Nuova serves 45 automotive and electronics manufacturers in Europe."), "Nuova", byId, ok)).toBeNull();
  });
  it("a source that is not allowed, unknown, or missing is rejected", () => {
    expect(sentenceProblem(S("what", "x y z", ["S9"]), "Nuova", { ...byId, S9: { content: "x" } }, ok)).toBe("source_not_allowed");
    expect(sentenceProblem(S("what", "Nuova predicts disruptions.", ["Z1"]), "Nuova", byId, ok)).toBe("source_not_found");
    expect(sentenceProblem(S("what", "Nuova predicts disruptions.", []), "Nuova", byId, ok)).toBe("no_source");
  });
  it("a sentence none of whose sources comes near it has no support", () => {
    expect(sentenceProblem(S("edge", "Nuova builds quantum batteries for orbiting satellites."), "Nuova", byId, ok)).toBe("no_supporting_sentence");
  });
  it("claims: numbers and capitalised names, not the first word or the company", () => {
    expect(claims("Nuova sells to Siemens and 45 others in Germany.", "Nuova")).toEqual({ numbers: ["45"], names: ["Siemens", "Germany"] });
  });
});

describe("the description", () => {
  it("is what + for_whom (+ edge), in that order, from verified sentences only", () => {
    const r = processDescription({ sentences: [
      S("for_whom", "Customers include automotive and electronics manufacturers in Europe."),
      S("what", "Nuova predicts supply-chain disruptions for global manufacturers using machine learning."),
      S("edge", "It is a revolutionary platform with seamless integrations.", ["W1"]),
    ] }, "Nuova", byId, ok);
    expect(r?.sentences.map((s) => s.role)).toEqual(["what", "for_whom"]);
    expect(r?.description.startsWith("Nuova predicts")).toBe(true);
    expect(r?.dropped.map((d) => d.why)).toEqual(["marketing_word"]);
    expect(r?.sentences[0].quote).toMatch(/machine learning/);
  });
  it("without a verified what and for_whom there is no description", () => {
    expect(processDescription({ sentences: [S("what", "Nuova predicts supply-chain disruptions for global manufacturers using machine learning.")] }, "Nuova", byId, ok)).toBeNull();
    expect(processDescription({ sentences: [] }, "Nuova", byId, ok)).toBeNull();
    expect(processDescription(null, "Nuova", byId, ok)).toBeNull();
  });
});

import { MARKETING as MKT, tooOldForDescription, descriptionSources as dSources } from "./descriptionBuilder";
describe("review 7 (7.25 AYOXXA, 2026-11-09): superlatives, and a source older than two years", () => {
  it("'lowest sample volume' and its kind are marketing, not description", () => {
    for (const t of ["Together with lowest sample volume in the multiplex protein arena", "the fastest platform", "the first company to", "the largest provider of", "the best tool for"]) expect(MKT.test(t)).toBe(true);
    expect(MKT.test("Pynt offers dynamic API security testing for developers and testers")).toBe(false);
  });
  it("a dated article older than two years is not a source; the company's own pages and recent articles are", () => {
    const old = { url: "https://www.prnewswire.com/news-releases/ayoxxa-biosystems-extends-series-b-284438681.html", content: "Published Time: 2015-11-04\nAYOXXA…", source_type: "press_release" as const };
    const recent = { url: "https://example.com/2026/09/ayoxxa", content: "AYOXXA…", source_type: "news" as const };
    const own = { url: "https://ayoxxa.com/about", content: "Published Time: 2015-01-01", source_type: "company_site" as const };
    expect(tooOldForDescription(old, "2026-11-09")).toBe(true);
    expect(tooOldForDescription(recent, "2026-11-09")).toBe(false);
    expect(tooOldForDescription(own, "2026-11-09")).toBe(false);
    const all = [old, recent, own].map((x, i) => ({ ...x, source_id: `S${i}`, title: "", provider: "serper", query_label: "x" })) as never;
    expect((dSources(all, () => true) as Array<{ source_id: string }>).map((x) => x.source_id)).toEqual(["S2", "S1"]);
  });
});
