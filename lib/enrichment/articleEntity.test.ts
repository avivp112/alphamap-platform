import { describe, it, expect } from "vitest";
import { countryOfHost, judgeArticleEntity, keepArticle, buildArticleEntityRequest, parseArticleEntity } from "./articleEntity.ts";

const datax = { name: "DataX", website: "https://datax.co.jp", countryHint: "Japan", about: "" };
const marvel = { name: "Marvel App", website: "https://marvelapp.com", countryHint: null, about: "A design and prototyping platform for digital products." };

describe("the country a domain suggests", () => {
  it("reads country-code domains", () => {
    expect(countryOfHost("datax.co.jp")).toBe("Japan");
    expect(countryOfHost("www.alus.ca")).toBe("Canada");
    expect(countryOfHost("aerobotix.co.il")).toBe("Israel");
  });
  it("is null for .com, .io, .ai", () => {
    for (const h of ["marvelapp.com", "x.io", "y.ai", "localhost"]) expect(countryOfHost(h)).toBeNull();
  });
});

describe("an article about a namesake (batch 4 dry run)", () => {
  it("asks with the country and the profile, and with the article", () => {
    const req = buildArticleEntityRequest(datax, { title: "Equifax Acquires DataX to Expand Credit Access for Consumers", url: "https://www.prnewswire.com/x", text: "Equifax ... Atlanta" });
    const text = req.messages[0].content;
    expect(text).toContain("Japan");
    expect(text).toContain("Equifax Acquires DataX");
  });
  it("drops what the model says is another company (DataX US, Marvel Comics)", async () => {
    for (const c of [datax, marvel]) {
      const r = await judgeArticleEntity(async () => ({ verdict: "other_company", reason: "a namesake" }), c, { title: "t", url: "https://x.com/a", text: "" });
      expect(r.keep).toBe(false);
    }
  });
  it("keeps the company's own news", async () => {
    const r = await judgeArticleEntity(async () => ({ verdict: "this_company", reason: "same app" }), marvel, { title: "Marvel's iPhone App Turns Sketches Into Prototypes", url: "https://techcrunch.com/x", text: "" });
    expect(r.keep).toBe(true);
  });
  it("drops 'unclear' when the profile has nothing to compare against, keeps it when it has", () => {
    expect(keepArticle({ verdict: "unclear" }, { name: "X", website: null, countryHint: null, about: "" })).toBe(false);
    expect(keepArticle({ verdict: "unclear" }, marvel)).toBe(true);
  });
  it("drops the article when the check itself fails and nothing is known about the company", async () => {
    const r = await judgeArticleEntity(async () => { throw new Error("api"); }, { name: "X", website: null, countryHint: null, about: "" }, { title: "t", url: "https://x.com", text: "" });
    expect(r.keep).toBe(false);
  });
  it("parses odd answers as unclear", () => {
    expect(parseArticleEntity({ verdict: "maybe" }).verdict).toBe("unclear");
    expect(parseArticleEntity(null).verdict).toBe("unclear");
  });
});
