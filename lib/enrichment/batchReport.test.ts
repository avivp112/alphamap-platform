import { describe, it, expect } from "vitest";
import { numberValues, renderBatchReport, batchCsv, marksFromBatch, trackerLine } from "./batchReport";

const v = (field: string, company: string, value: string, source_url = "https://x.com/a", quote = "") => ({ company_id: company, company, field, value, source_url, quote });

describe("the writing batch's report (owner, 2026-11-05)", () => {
  const values = numberValues([v("news", "Acme", "2025-01-01 — Acme raises", "https://techcrunch.com/a", "Acme raised $5M"), v("hq_city", "Acme", "London"), v("hq_city", "Beta", "Berlin")], 3, "w");
  it("numbers the values by field and company: w3.1, w3.2…", () => {
    expect(values.map((x) => [x.id, x.field, x.company])).toEqual([["w3.1", "hq_city", "Acme"], ["w3.2", "hq_city", "Beta"], ["w3.3", "news", "Acme"]]);
  });
  it("prints source and quote, and ends with the undo command and the way to enter the verdicts", () => {
    const text = renderBatchReport(values, { batchNo: 3, runId: "run-9", dry: false, csvPath: "field_review/batch_3.csv" });
    expect(text).toContain("w3.3  Acme: 2025-01-01 — Acme raises");
    expect(text).toContain('quote: "Acme raised $5M"');
    expect(text).toContain("RUN_ID=run-9 DRY_RUN=false npx tsx scripts/undo_run.ts");
    expect(text).toContain("BATCH=field_review/batch_3.csv WRONG=");
    expect(renderBatchReport(values, { batchNo: 3, runId: null, dry: true })).not.toContain("undo_run");
  });
  it("the owner names the wrong ones; the rest is correct; an unknown number is reported", () => {
    const { marks, unknown } = marksFromBatch(values, ["w3.2", "w9.9"], "owner test");
    expect(marks.map((m) => [m.id, m.verdict])).toEqual([["w3.1", "correct"], ["w3.2", "wrong"], ["w3.3", "correct"]]);
    expect(unknown).toEqual(["w9.9"]);
  });
  it("a comma in a value cannot shift the tracker's columns (run 1's 1.35)", () => {
    const m = marksFromBatch(numberValues([v("news", "Leverate", "Launches ASK, Its Native AI Assistant")], 1, "w"), [], "n").marks[0];
    expect(trackerLine(m)).toBe('w1.1,news,Leverate,"Launches ASK, Its Native AI Assistant",https://x.com/a,correct,n');
    expect(batchCsv(numberValues([v("news", "L", "a, b")], 1, "w"))).toContain('"a, b"');
  });
});

describe("the wet batch report points at the provenance check (owner, 2026-11-08)", () => {
  it("names scripts/verify_batch.ts with the batch file and the run", () => {
    const text = renderBatchReport([], { batchNo: 7, runId: "run-1", dry: false, csvPath: "field_review/batch_7.csv" });
    expect(text).toContain("BATCH=field_review/batch_7.csv RUN_ID=run-1 npx tsx scripts/verify_batch.ts");
    expect(renderBatchReport([], { batchNo: 7, runId: null, dry: true })).not.toContain("verify_batch");
  });
});
