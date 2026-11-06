/**
 * eval/sheetCli.ts — look at a review sheet in the terminal and mark it by number, without a
 * spreadsheet (owner, 2026-11-06). Pure. Rows are numbered by their place in the file, so a number
 * means the same row on every run; a mark is "y" or "n", which import_review.ts reads
 * as נכון / של החברה and לא נכון / לא של החברה.
 */
import type { SheetRow } from "./reviewSheet.ts";

export type Sheet = "competitors" | "patents" | "rounds";
export const SHEET_FILES: Record<Sheet, string> = { competitors: "competitors_review.csv", patents: "patents_review.csv", rounds: "rounds_review.csv" };

/** "1-9=y,12=n,15=y" → row number → "y" | "n". Throws on anything it cannot read, so nothing is half-applied. */
export function parseMarkSpec(spec: string): Map<number, "y" | "n"> {
  const out = new Map<number, "y" | "n">();
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?\s*=\s*(y|n)$/i);
    if (!m) throw new Error(`cannot read "${part}" — write N=y or N-M=n`);
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (b < a) throw new Error(`"${part}": the range runs backwards`);
    for (let i = a; i <= b; i++) out.set(i, m[3].toLowerCase() as "y" | "n");
  }
  return out;
}

export function applySheetMarks(rows: SheetRow[], marks: Map<number, "y" | "n">): { rows: SheetRow[]; applied: number; unknown: number[] } {
  const unknown = [...marks.keys()].filter((n) => n < 1 || n > rows.length);
  const out = rows.map((r, i) => (marks.has(i + 1) ? { ...r, mark: marks.get(i + 1)! } : r));
  return { rows: out, applied: marks.size - unknown.length, unknown };
}

const clip = (s: string | undefined, n: number) => ((s ?? "").length > n ? `${(s ?? "").slice(0, n)}…` : s ?? "");

/** The rows, numbered, grouped by company; by default only the unmarked ones. */
export function sheetListing(rows: SheetRow[], sheet: Sheet, all = false): string {
  const lines: string[] = [];
  let company = "";
  rows.forEach((r, i) => {
    if (!all && r.mark?.trim()) return;
    if (r.company !== company) { company = r.company; lines.push("", `── ${company}`); }
    const n = String(i + 1).padStart(3);
    const mark = r.mark?.trim() ? `  [${r.mark.trim()}]` : "";
    if (sheet === "competitors") lines.push(`${n}  ${r.competitor}${mark}`, `       source: ${r.source_url || "(none)"}`, `       quote:  ${clip(r.quote, 260) || "(none)"}`);
    else if (sheet === "patents") lines.push(`${n}  ${r.publication}${mark}  ${clip(r.title, 90)}`, `       applicants: ${clip(r.applicants, 160) || "(none)"}`);
    else lines.push(`${n}  ${r.round_type} ${r.amount_usd || "(no amount)"} ${r.date || "(no date)"}${r.lead_investor ? ` led by ${r.lead_investor}` : ""}${mark}`, `       source: ${r.source_url || "(none)"}`);
  });
  return lines.join("\n");
}
