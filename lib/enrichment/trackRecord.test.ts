import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { addToTrackRecord, fieldsWithoutHistory, readTrackRecord } from "./batchProcess";

describe("field track record (owner, 2026-11-19)", () => {
  it("adds a batch's sample once, and names the fields with too little history", () => {
    const f = join(mkdtempSync(join(tmpdir(), "tr-")), "field_track_record.json");
    expect(fieldsWithoutHistory(["news", "round", "description_what_only"], readTrackRecord(f))).toEqual(["news", "round", "description"]);
    addToTrackRecord(8, [{ field: "news", total: 12, wrong: 1 }, { field: "round", total: 20, wrong: 0 }], f);
    addToTrackRecord(8, [{ field: "news", total: 12, wrong: 1 }, { field: "round", total: 20, wrong: 0 }], f);   // the same batch again: replaced, not doubled
    const rec = JSON.parse(readFileSync(f, "utf8"));
    expect(rec.news).toMatchObject({ reviewed: 12, wrong: 1, batches: [8] });
    expect(fieldsWithoutHistory(["news", "round"], readTrackRecord(f))).toEqual(["news"]);
    addToTrackRecord(9, [{ field: "news", total: 10, wrong: 0 }], f);
    expect(fieldsWithoutHistory(["news", "round"], readTrackRecord(f))).toEqual([]);
  });
});

import { fieldDecisions, markKey, readMarks, saveMarks } from "./batchProcess";
import { foundedInCityYear } from "./siteFacts";
describe("the owner's field rule after the sample (2026-11-19)", () => {
  const row = (n: number, company: string, field: string) => ({ n, company, field, value: `v${n}` });
  it("errors in 1-5 companies: written; more than 5: held; few values: held; a dangerous field with an unknown cause: held", () => {
    const sample = [...Array.from({ length: 8 }, (_, i) => row(i + 1, `C${i}`, "news")), ...Array.from({ length: 8 }, (_, i) => row(20 + i, `D${i}`, "tags")), row(40, "E", "founded_year")];
    const wrong = new Map<number, string>([[1, "address date"], [2, "guide"], [20, "a"], [21, "b"], [22, "c"], [23, "d"], [24, "e"], [25, "f"], [40, "wrong in the sample check"]]);
    const record = { news: { reviewed: 70, wrong: 1, batches: [7] }, tags: { reviewed: 40, wrong: 1, batches: [7] }, founded_year: { reviewed: 5, wrong: 0, batches: [7] } };
    const d = Object.fromEntries(fieldDecisions(sample, wrong, record).map((x) => [x.field, x]));
    expect(d.news.hold).toBe(false);          // 2 companies, enough history
    expect(d.tags.hold).toBe(true);           // 6 companies
    expect(d.founded_year.hold).toBe(true);   // one value in the sample, short history, dangerous with an unknown cause
    expect(d.founded_year.why).toMatch(/too few values/);
  });
  it("marks are kept by company, field and value", () => {
    const f = join(mkdtempSync(join(tmpdir(), "mk-")), "m.json");
    saveMarks([{ company: "Acme", field: "news", value: "2020-01-01 — Acme raises", verdict: "correct", reason: "" }], 8, f);
    expect(readMarks(f)[markKey("acme", "news", "2020-01-01 — Acme raises")]?.verdict).toBe("correct");
  });
  it("a founding year in a sentence about another company is not this company's", () => {
    expect(foundedInCityYear(["Getir, which was founded in Turkey in 2015, bought up rival Gorillas in a $1.2bn deal after snapping up the UK's Weezy."], "Weezy")).toBeNull();
    expect(foundedInCityYear(["Weezy, founded in London in 2019, delivers groceries."], "Weezy")?.year).toBe(2019);
  });
});
