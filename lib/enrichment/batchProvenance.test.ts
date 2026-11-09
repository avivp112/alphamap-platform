import { describe, it, expect } from "vitest";
import { checkBatchProvenance, expectedProvenance, renderProvenanceReport, type BatchRow, type ProvRow } from "./batchProvenance";

const v = (id: string, field: string, value: string, company_id = "c1", company = "Acme"): BatchRow => ({ id, field, company, company_id, value });
const p = (field: string, source_url: string | null = "https://s.example/x", startup_id = "c1"): ProvRow => ({ startup_id, field, source_url, run_id: "r1" });

describe("every value a wet batch wrote has its source on file (owner, 2026-11-08)", () => {
  it("maps each pilot field to the provenance field the writer records", () => {
    expect(expectedProvenance(v("1", "hq_city", "Tel Aviv"))).toEqual({ exact: "profile.city" });
    expect(expectedProvenance(v("2", "news", "2026-01-02 — Acme raises $5M — Series A"))).toEqual({ exact: "news.Acme raises $5M — Series A" });
    expect(expectedProvenance(v("3", "leader", "Aviv Cohen — Chief Marketing Officer"))).toEqual({ exact: "leadership.Aviv Cohen" });
    expect(expectedProvenance(v("4", "founder", "Adam Rimon — Co-Founder"))).toEqual({ exact: "founders.Adam Rimon" });
    expect(expectedProvenance(v("5", "patent", "US2021166364A1 Automated inspection"))).toEqual({ exact: "patents.US2021166364A1" });
    expect(expectedProvenance(v("6", "round", "Series B $70M · 2020-12-10"))).toEqual({ prefix: "funding_rounds." });
    expect(expectedProvenance(v("7", "description", "x"))).toBeNull();
  });
  it("a value with its row and source is ok; without the row, missing; a row with no URL, no_source", () => {
    const out = checkBatchProvenance(
      [v("w1.1", "hq_city", "Austin"), v("w1.2", "leader", "Lori Jones — CEO"), v("w1.3", "news", "2025-01-29 — Tenable Plans to Acquire Vulcan Cyber")],
      [p("profile.city"), p("news.Tenable Plans to Acquire Vulcan Cyber", null)],
    );
    expect(out.map((c) => c.status)).toEqual(["ok", "missing", "no_source"]);
  });
  it("rows of another company, or no row for this company's field, do not count", () => {
    expect(checkBatchProvenance([v("1", "hq_city", "Austin", "c1")], [p("profile.city", "https://s/x", "c2")])[0].status).toBe("missing");
  });
  it("rounds: one provenance round per round value; a second value with no second round is missing", () => {
    const prov = [p("funding_rounds.r-1.amount_raised"), p("funding_rounds.r-1.announcement_date")];
    const out = checkBatchProvenance([v("1", "round", "Seed $5M"), v("2", "round", "Series A $20M")], prov);
    expect(out.map((c) => c.status)).toEqual(["ok", "missing"]);
  });
  it("a field the pilot does not write is flagged as such, not as missing", () => {
    expect(checkBatchProvenance([v("1", "tags", "A, B")], [])[0].status).toBe("not_written_in_pilot");
  });
  it("the report says what to do when a value has no source", () => {
    const checks = checkBatchProvenance([v("w1.1", "leader", "Lori Jones — CEO")], []);
    expect(renderProvenanceReport(checks, "run-9")).toContain("RUN_ID=run-9 DRY_RUN=false npx tsx scripts/undo_run.ts");
    expect(renderProvenanceReport(checkBatchProvenance([v("w1.1", "hq_city", "A")], [p("profile.city")]), "run-9")).toContain("✅ every value written");
  });
});
