import { describe, it, expect } from "vitest";
import { toCsv, parseCsv, mergeRows, competitorKey, applyCompetitorMarks, applyPatentMarks, COMPETITOR_COLUMNS, NO_PUBLICATIONS } from "./reviewSheet";
import type { GoldenCompany } from "./score";

describe("the owner's review sheets (2026-10-27)", () => {
  it("round-trips Hebrew marks, commas and quotes through the CSV Excel opens", () => {
    const rows = [{ company_id: "chalice", company: "Chalice", competitor: "Cognitiv, Inc.", source_url: "https://www.adexchanger.com/x", quote: 'an "early rival" to Cognitiv', mark: "נכון" }];
    const csv = toCsv(COMPETITOR_COLUMNS, rows);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it("a sheet built again keeps the marks already made", () => {
    const marked = [{ company_id: "chalice", company: "Chalice", competitor: "Cognitiv", source_url: "", quote: "", mark: "נכון" }];
    const merged = mergeRows(marked, [
      { company_id: "chalice", company: "Chalice", competitor: "Cognitiv Inc", source_url: "", quote: "", mark: "" },
      { company_id: "chalice", company: "Chalice", competitor: "Powerlytics", source_url: "", quote: "", mark: "" },
    ], competitorKey);
    expect(merged.map((r) => [r.competitor, r.mark])).toEqual([["Cognitiv", "נכון"], ["Powerlytics", ""]]);
  });

  it("marks become golden competitors — Cognitiv right, Powerlytics wrong, an unmarked row waits", () => {
    const companies: GoldenCompany[] = [{ id: "chalice", name: "Chalice", competitors: { names: [], not_competitors: [], confidence: "verified" } }];
    const r = applyCompetitorMarks(companies, [
      { company_id: "chalice", company: "Chalice", competitor: "Cognitiv", source_url: "https://www.adexchanger.com/x", quote: "", mark: "נכון" },
      { company_id: "chalice", company: "Chalice", competitor: "Powerlytics", source_url: "", quote: "", mark: "לא נכון" },
      { company_id: "chalice", company: "Chalice", competitor: "Algocraft", source_url: "", quote: "", mark: "" },
      { company_id: "chalice", company: "Chalice", competitor: "Nano", source_url: "", quote: "", mark: "?" },
    ]);
    expect(r).toEqual({ applied: 2, unmarked: 1, unreadable: ['Chalice: Nano — "?"'] });
    expect(companies[0].competitors).toEqual({ names: ["Cognitiv"], not_competitors: ["Powerlytics"], confidence: "verified", source_urls: ["https://www.adexchanger.com/x"] });
  });

  it("patents: only the publications marked as the company's — 1AHEAD's own, not Snap's", () => {
    const companies: GoldenCompany[] = [{ id: "1ahead", name: "1AHEAD Technologies" }, { id: "as0001", name: "AS0001" }];
    const r = applyPatentMarks(companies, [
      { company_id: "1ahead", company: "1AHEAD", publication: "US11756357B2", title: "", applicants: "1AHEAD TECHNOLOGIES [US]", family_id: "1", mark: "של החברה" },
      { company_id: "1ahead", company: "1AHEAD", publication: "US10102680B2", title: "", applicants: "SNAP INC [US]", family_id: "2", mark: "לא של החברה" },
      { company_id: "as0001", company: "AS0001", publication: NO_PUBLICATIONS, title: "", applicants: "", family_id: "", mark: "נכון" },
    ]);
    expect(r.companies).toEqual(["1AHEAD Technologies", "AS0001"]);
    expect(companies[0].patents).toMatchObject({ numbers: ["US11756357B2"], confidence: "verified" });
    expect(companies[1].patents).toMatchObject({ numbers: [], none: true });
  });

  it("patents: a company with an unmarked row is not imported — a half list would be wrong", () => {
    const companies: GoldenCompany[] = [{ id: "azumo", name: "Azumo" }];
    const r = applyPatentMarks(companies, [
      { company_id: "azumo", company: "Azumo", publication: "US11442213B2", title: "", applicants: "AZUMO INC [US]", family_id: "1", mark: "של החברה" },
      { company_id: "azumo", company: "Azumo", publication: "US8917962B1", title: "", applicants: "AZUMO INC [US]", family_id: "2", mark: "" },
    ]);
    expect(r).toMatchObject({ companies: [], unmarked: 1 });
    expect(companies[0].patents).toBeUndefined();
  });
});

describe("rounds v2 found that the golden set lacks (owner, 2026-10-29)", () => {
  it("'נכון' adds a verified golden round with its source, once; 'לא נכון' adds nothing", async () => {
    const { applyRoundMarks } = await import("./reviewSheet");
    const companies = [{ id: "aidoc", name: "Aidoc", funding_rounds: [{ type: "Series D", amount_usd: 110_000_000, date: "2022-06", confidence: "verified" as const }] }];
    const rows = [
      { company_id: "aidoc", company: "Aidoc", round_type: "Series C", amount_usd: "66000000", date: "2021-07-19", lead_investor: "", source_url: "https://www.aidoc.com/about/news/series-c", mark: "נכון" },
      { company_id: "aidoc", company: "Aidoc", round_type: "Seed", amount_usd: "4000000", date: "2016-10-01", lead_investor: "", source_url: "", mark: "לא נכון" },
      { company_id: "aidoc", company: "Aidoc", round_type: "Other", amount_usd: "190000000", date: "", lead_investor: "", source_url: "", mark: "" },
    ];
    const r = applyRoundMarks(companies, rows);
    expect(r).toEqual({ applied: 2, unmarked: 1, unreadable: [] });
    applyRoundMarks(companies, rows);
    expect(companies[0].funding_rounds.map((x) => [x.type, x.amount_usd])).toEqual([["Series D", 110_000_000], ["Series C", 66_000_000]]);
  });
});
