/**
 * lib/enrichment/postWrite.ts — the pure parts of what happens after a wet write (owner, 2026-11-22): a few core values that are not in the database do not undo the batch; they are taken out of it.
 *   parseVerifyMissing   the "✗ Company · field: value" lines of verify_written
 *   quarantinable        how many missing values may be taken out (up to 10 or 2% of the values checked); more is a systematic fault and the batch is undone
 *   dropRowsFromCsv      the report without the values taken out, so that verify_written, the baseline and the audit see only what was written
 */
import { parseCsv } from "./acceptance.ts";

export interface MissingLine { company: string; field: string; valueStart: string }
export function parseVerifyMissing(stdout: string): MissingLine[] {
  return stdout.split("\n").flatMap((l) => { const m = l.match(/^\s*✗ (.+?) · (\w+): (.*)$/); return m ? [{ company: m[1], field: m[2], valueStart: m[3].trim() }] : []; });
}
export const quarantinable = (missing: number, checked: number): boolean => missing > 0 && missing <= Math.max(10, Math.floor(checked * 0.02));

export function dropRowsFromCsv(csv: string, drop: Array<{ company: string; field: string; after: string }>): { text: string; removed: number } {
  const [head, ...body] = parseCsv(csv.replace(/^﻿/, ""));
  const ci = head.indexOf("company"), fi = head.indexOf("field"), ai = head.indexOf("after");
  const key = (c: string, f: string, a: string) => `${c}\u0001${f}\u0001${a}`;
  const gone = new Set(drop.map((d) => key(d.company, d.field, d.after)));
  const keep = body.filter((r) => !gone.has(key(r[ci] ?? "", r[fi] ?? "", r[ai] ?? "")));
  const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return { text: "﻿" + [head, ...keep].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n", removed: body.length - keep.length };
}
