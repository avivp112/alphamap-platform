import { describe, it, expect } from "vitest";
import { classifyRun, countKeys } from "./run-classify";

const rows = countKeys("ingested");

describe("classifyRun — every source run gets an honest status", () => {
  it("a missing key is an error, with the fix", () => {
    const r = classifyRun(500, { error: "COMPANIES_HOUSE_API_KEY is not set.", fix: "supabase secrets set ..." }, rows);
    expect(r).toMatchObject({ status: "error", rows_in: 0, http_status: 500 });
    expect(r.error).toContain("COMPANIES_HOUSE_API_KEY is not set.");
    expect(r.error).toContain("fix: supabase secrets set");
  });
  it("an upstream API error is an error", () => {
    expect(classifyRun(502, { error: "GitHub returned 403" }, countKeys("recorded")).status).toBe("error");
    expect(classifyRun(404, "Function not found", rows).status).toBe("error");
  });
  it("rows in = ok; nothing in = empty", () => {
    expect(classifyRun(200, { ingested: 12, results: [] }, rows)).toMatchObject({ status: "ok", rows_in: 12 });
    expect(classifyRun(200, { ingested: 0, note: "no Form D filings in this day's index" }, rows)).toMatchObject({ status: "empty", rows_in: 0 });
    expect(classifyRun(200, { ingested: 3, fundsRecorded: 5 }, countKeys("ingested", "fundsRecorded")).rows_in).toBe(8);
  });
  it("every item failing is an error, some failing is partial", () => {
    const allFailed = { recorded: 0, results: [{ ok: false, reason: "upsert: permission denied" }, { ok: false }] };
    expect(classifyRun(200, allFailed, countKeys("recorded"))).toMatchObject({ status: "error" });
    expect(classifyRun(200, allFailed, countKeys("recorded")).error).toContain("permission denied");
    const some = { recorded: 4, results: [{ ok: true }, { ok: false, reason: "timeout" }] };
    expect(classifyRun(200, some, countKeys("recorded"))).toMatchObject({ status: "partial", rows_in: 4 });
    expect(classifyRun(200, { upserted: 0, failed: 3, results: [] }, countKeys("upserted")).status).toBe("error");
  });
  it("a dry run or a synthetic sample is not a run", () => {
    expect(classifyRun(200, { dryRun: true, ingested: 0 }, rows).status).toBe("dry_run");
    expect(classifyRun(200, { synthetic: true }, rows).status).toBe("dry_run");
  });
  it("keeps the logged detail small", () => {
    const r = classifyRun(200, { ingested: 1, results: Array.from({ length: 50 }, () => ({ ok: true })) }, rows);
    expect(r.detail.results).toBe("[50 items]");
  });
});
