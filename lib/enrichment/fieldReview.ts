/**
 * lib/enrichment/fieldReview.ts — which fields are open for writing (owner,
 * 2026-11-02): a field opens when the owner has marked at least 20 of its
 * values and at least 90% of them are correct (a round: its amount and its
 * date). The marks live in eval/field_review_tracker.csv, filled from the
 * samples scripts/field_review.ts prints. Pure but for reading that file.
 */

import { existsSync, readFileSync } from "fs";

export const MIN_MARKED = 20;
export const MIN_CORRECT = 0.9;
export const TRACKER = "eval/field_review_tracker.csv";

/** A reviewed field → the startups column(s) the pilot writes for it (scalar fields only, for now). */
export const FIELD_COLUMNS: Record<string, string[]> = {
  hq_city: ["city"], hq_country: ["country"], founded_year: ["founded_year"], founding_country: ["founding_country"],
  employee_range: ["employee_range"], employee_count: ["employee_count"], office: ["offices", "office_countries"],
};

export interface Mark { id: string; field: string; company: string; value: string; source_url: string; verdict: "correct" | "wrong"; source_of_mark: string }

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function readMarks(path = process.env.FIELD_REVIEW_TRACKER ?? TRACKER): Mark[] {
  if (!existsSync(path)) return [];
  const [head, ...rows] = parseCsv(readFileSync(path, "utf8").replace(/^﻿/, ""));
  const at = (name: string) => head.indexOf(name);
  return rows.map((r) => ({
    id: r[at("id")], field: r[at("field")], company: r[at("company")], value: r[at("value")], source_url: r[at("source_url")],
    verdict: (r[at("verdict")] === "correct" ? "correct" : "wrong") as Mark["verdict"], source_of_mark: r[at("source_of_mark")] ?? "",
  }));
}

export interface FieldStatus { field: string; marked: number; correct: number; share: number | null; open: boolean }

export function fieldStatus(marks: Mark[]): FieldStatus[] {
  const fields = [...new Set(marks.map((m) => m.field))];
  return fields.map((field) => {
    const mine = marks.filter((m) => m.field === field);
    const correct = mine.filter((m) => m.verdict === "correct").length;
    const share = mine.length ? correct / mine.length : null;
    return { field, marked: mine.length, correct, share, open: mine.length >= MIN_MARKED && share != null && share >= MIN_CORRECT };
  });
}

/** The startups columns open for writing by the review (scalar fields). */
export function openColumns(marks: Mark[] = readMarks()): string[] {
  return fieldStatus(marks).filter((s) => s.open).flatMap((s) => FIELD_COLUMNS[s.field] ?? []);
}
