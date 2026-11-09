/**
 * lib/enrichment/batchReport.ts — the end-of-run report of a writing batch (owner, 2026-11-05).
 *
 * Every value a batch wrote (or, dry, would write) is numbered, with its field, company, source
 * and quote, and the batch ends with the command that undoes it. The owner writes only the numbers
 * that are wrong; everything else is entered in the tracker as correct (scripts/mark_batch.ts).
 * Pure.
 */
import { WRITABLE_FIELDS } from "./writeUnits";
import type { Mark } from "./fieldReview";

export interface BatchValue { company_id: string; company: string; field: string; value: string; source_url: string; quote: string }
export interface NumberedValue extends BatchValue { id: string }

/** The values ordered by review field, each numbered `<prefix><batch>.<n>` (w3.1, w3.2…; d for a dry report). */
export function numberValues(values: BatchValue[], batchNo: number, prefix: "w" | "d"): NumberedValue[] {
  const order = (f: string) => { const i = WRITABLE_FIELDS.indexOf(f); return i < 0 ? 99 : i; };
  return [...values].sort((a, b) => order(a.field) - order(b.field) || a.company.localeCompare(b.company))
    .map((v, i) => ({ ...v, id: `${prefix}${batchNo}.${i + 1}` }));
}

export function renderBatchReport(values: NumberedValue[], opts: { batchNo: number; runId: string | null; dry: boolean; max?: number; csvPath?: string }): string {
  const max = opts.max ?? 80;
  const lines: string[] = [];
  const companies = new Set(values.map((v) => v.company_id)).size;
  lines.push("═".repeat(62));
  lines.push(`${opts.dry ? "Dry report" : "Wet batch"} ${opts.batchNo} — ${values.length} value(s) ${opts.dry ? "that would be written" : "written"} for ${companies} compan(ies)`);
  lines.push(`Answer with the numbers that are NOT correct; everything else is entered as correct.`);
  lines.push("");
  let field = "";
  for (const v of values.slice(0, max)) {
    if (v.field !== field) { field = v.field; lines.push(`[${field}]`); }
    lines.push(`  ${v.id}  ${v.company}: ${v.value.slice(0, 220)}`);
    lines.push(`        source: ${v.source_url || "—"}${v.quote ? `\n        quote: "${v.quote.slice(0, 180)}"` : ""}`);
  }
  if (values.length > max) lines.push(`  … and ${values.length - max} more in ${opts.csvPath ?? "the batch file"}`);
  lines.push("");
  if (!opts.dry && opts.runId) {
    lines.push(`Undo this batch (report only): RUN_ID=${opts.runId} npx tsx scripts/undo_run.ts`);
    lines.push(`Undo this batch (for real):    RUN_ID=${opts.runId} DRY_RUN=false npx tsx scripts/undo_run.ts`);
  }
  if (!opts.dry && opts.runId && opts.csvPath) lines.push(`Verify that every value has its source on file (read only): BATCH=${opts.csvPath} RUN_ID=${opts.runId} npx tsx scripts/verify_batch.ts`);
  if (!opts.dry && opts.csvPath) lines.push(`Enter the verdicts: BATCH=${opts.csvPath} WRONG=<numbers, comma-separated> npx tsx scripts/mark_batch.ts`);
  return lines.join("\n");
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function batchCsv(values: NumberedValue[]): string {
  const cols = ["id", "field", "company", "value", "source_url", "quote", "company_id"] as const;
  return "﻿" + [cols.join(","), ...values.map((v) => cols.map((c) => cell(String(v[c] ?? ""))).join(","))].join("\r\n") + "\r\n";
}

/** The tracker rows of a batch: the numbers the owner named are wrong, every other value correct. */
export function marksFromBatch(values: NumberedValue[], wrong: string[], note: string): { marks: Mark[]; unknown: string[] } {
  const wrongSet = new Set(wrong.map((w) => w.trim()).filter(Boolean));
  const known = new Set(values.map((v) => v.id));
  return {
    marks: values.map((v) => ({
      id: v.id, field: v.field, company: v.company, value: v.value, source_url: v.source_url,
      verdict: wrongSet.has(v.id) ? "wrong" as const : "correct" as const, source_of_mark: note,
    })),
    unknown: [...wrongSet].filter((w) => !known.has(w)),
  };
}

/** A tracker line, quoted wherever a comma would shift the columns (run 1's 1.35). */
export function trackerLine(m: Mark): string {
  return [m.id, m.field, m.company, m.value, m.source_url, m.verdict, m.source_of_mark].map(cell).join(",");
}
