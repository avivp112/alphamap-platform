import { describe, it, expect } from "vitest";
import { foundersFromText, personMentionedIn, cleanPeople } from "./people";
import { parseLinkedInPersonResult } from "./linkedin";

describe("foundersFromText — 'founded by' sentences about THIS company", () => {
  it("reads the founders from a subject sentence (real GoCo / Glints quotes)", () => {
    expect(foundersFromText("GoCo.io, Inc. was founded in 2015 by Jason J. Wang, Michael Gugel, and Nir Leibovich.", "GoCo").map((f) => f.name))
      .toEqual(["Jason J. Wang", "Michael Gugel", "Nir Leibovich"]);
    expect(foundersFromText("Glints was founded in August 2013 by Oswald Yeo, Looi Qin En, and Seah Ying Cong.", "Glints").map((f) => f.name))
      .toEqual(["Oswald Yeo", "Looi Qin En", "Seah Ying Cong"]);
  });
  it("marks co-founders and strips parentheticals", () => {
    expect(foundersFromText("HighLevel was co-founded by Shaun Clark (CEO), Varun Vairavan, and Robin Alex in 2018.", "HighLevel"))
      .toEqual([{ name: "Shaun Clark", title: "Co-founder" }, { name: "Varun Vairavan", title: "Co-founder" }, { name: "Robin Alex", title: "Co-founder" }]);
  });
  it("never takes another company's founders from a sentence that merely names ours", () => {
    expect(foundersFromText("Rival Acme, founded by John Doe, competes with Gladia.", "Gladia")).toEqual([]);
    expect(foundersFromText("Unlike Gladia, Speechmatics was founded by Tony Robinson.", "Gladia")).toEqual([]);
  });
  it("accepts 'It was founded by' only on a page about the company", () => {
    const text = "It was founded in 2022 by Jean-Louis Queguiner and Jonathan Soto.";
    expect(foundersFromText(text, "Gladia", { url: "https://techcrunch.com/2024/10/15/gladia-series-a" })).toHaveLength(2);
    expect(foundersFromText(text, "Gladia", { url: "https://example.com/speech-apis" })).toEqual([]);
  });
  it("ignores non-person names", () => {
    expect(foundersFromText("Acme was founded by former Google engineers.", "Acme")).toEqual([]);
  });
});

describe("LinkedIn founder discovery — the company must be what they founded (GoHighLevel got agency owners)", () => {
  const r = (title: string, content: string) => ({ url: "https://www.linkedin.com/in/x", title, content });
  it("rejects 'Founder at <their agency> | GoHighLevel expert' and 'Founder of Cumulus' who mentions Global Relay", () => {
    expect(parseLinkedInPersonResult(r("Sophie Arambula - Founder at Bloom Agency | GoHighLevel Expert | LinkedIn", ""), "GoHighLevel")?.isFounder).toBe(false);
    expect(parseLinkedInPersonResult(r("Michael Schwert - Founder of Cumulus Inc, The source for ... | LinkedIn", "Experience: Global Relay"), "Global Relay")?.isFounder).toBe(false);
  });
  it("accepts 'Co-founder & CEO at Gladia' and 'Gladia co-founder'", () => {
    expect(parseLinkedInPersonResult(r("Jean-Louis Quéguiner - Gladia | LinkedIn", "Co-founder & CEO at Gladia."), "Gladia")?.isFounder).toBe(true);
    expect(parseLinkedInPersonResult(r("Jonathan Soto – Co-founder & CTO – Gladia | LinkedIn", ""), "Gladia")?.isFounder).toBe(true);
    expect(parseLinkedInPersonResult(r("Ann Lee - Gladia co-founder | LinkedIn", ""), "Gladia")?.isFounder).toBe(true);
  });
});

describe("personMentionedIn / cleanPeople", () => {
  it("finds a name with accents or a middle initial", () => {
    expect(personMentionedIn("Jean-Louis Quéguiner", "CEO Jean-Louis Queguiner said")).toBe(true);
    expect(personMentionedIn("Jason Wang", "founded by Jason J. Wang and")).toBe(true);
    expect(personMentionedIn("Sophie Arambula", "Gladia raised $16M")).toBe(false);
  });
  it("drops single-name entries and duplicates", () => {
    expect(cleanPeople([{ name: "Shannon" }, { name: "Alex Viall" }, { name: "Viall" }, { name: "alex viall" }, { name: "Spencer Gareiss" }]).map((p) => p.name))
      .toEqual(["Alex Viall", "Spencer Gareiss"]);
  });
});
