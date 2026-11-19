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
