/**
 * lib/enrichment/reviewMore.ts — a second marking sheet from review runs already made, with no new run (owner, 2026-11-09):
 * run_7's sample held the fields it was asked for (seven), though run_7.csv held values of five more. Every value of the chosen fields
 * in the runs that is not marked yet. Pure.
 */
import type { Mark } from "./fieldReview.ts";

export interface RunRow { run: string; company_id: string; company: string; field: string; value: string; on_file: string; source_url: string; quote: string }

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const key = (field: string, company: string, value: string) => `${field}|${norm(company)}|${norm(value)}`;

/** The rows of these fields that no mark in the tracker covers (same field, company and value), once each, in the order of `fields`. */
export function unmarkedRows(rows: RunRow[], marks: Array<Pick<Mark, "field" | "company" | "value">>, fields: readonly string[]): RunRow[] {
  const marked = new Set(marks.map((m) => key(m.field, m.company, m.value)));
  const seen = new Set<string>();
  const out: RunRow[] = [];
  for (const f of fields) {
    for (const r of rows) {
      if (r.field !== f) continue;
      const k = key(r.field, r.company, r.value);
      if (marked.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}
