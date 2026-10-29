// =============================================================================
// eval/reviewSheet.ts — the owner's review sheets for the golden set
// (2026-10-27): a CSV that opens in Excel or Google Sheets, one row per value
// to judge, and a `mark` column the owner fills in. Marked rows become golden
// values (applyCompetitorMarks / applyPatentMarks); a sheet built again keeps
// every mark already made.
//
//   eval/review/competitors_review.csv   written by eval/run_eval.ts: every
//     competitor v2 found for the 20 companies under review that the golden
//     set does not judge yet — mark "נכון" or "לא נכון". Precision only: is
//     each competitor found really a competitor.
//   eval/review/rounds_review.csv        written by eval/run_eval.ts (owner,
//     2026-10-29): every round v2 found that matches no golden round, with
//     its source — mark "נכון" (a real round the golden set lacks: it joins
//     the golden set) or "לא נכון" (stays a wrong write).
//   eval/review/patents_review.csv       written by eval/patent_register_review.ts:
//     every publication the EPO register returns for the company's name —
//     mark "של החברה" or "לא של החברה" (the company is the owner or the filer).
//
// Pure; tested in reviewSheet.test.ts.
// =============================================================================

import type { GoldenCompany } from "./score.ts";
import { patentDigits } from "../lib/enrichment/patents.ts";

export type SheetRow = Record<string, string>;

export const COMPETITOR_COLUMNS = ["company_id", "company", "competitor", "source_url", "quote", "mark"] as const;
export const ROUND_COLUMNS = ["company_id", "company", "round_type", "amount_usd", "date", "lead_investor", "source_url", "mark"] as const;
export const PATENT_COLUMNS = ["company_id", "company", "publication", "title", "applicants", "family_id", "mark"] as const;

export const MARK_YES = new Set(["נכון", "של החברה", "כן", "yes", "correct", "y", "v", "✓"]);
export const MARK_NO = new Set(["לא נכון", "לא של החברה", "לא", "no", "wrong", "n", "x", "✗"]);
/** The row a company with no publication on the register gets; marked "נכון" it means: no patents. */
export const NO_PUBLICATIONS = "(no publications on the register)";

function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** UTF-8 with a BOM, so Excel shows Hebrew. */
export function toCsv(columns: readonly string[], rows: SheetRow[]): string {
  return "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c] ?? "")).join(","))].join("\r\n") + "\r\n";
}

export function parseCsv(text: string): SheetRow[] {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "", record: string[] = [], quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { record.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.some((f) => f !== "")) records.push(record);
      record = [];
    } else field += ch;
  }
  if (field !== "" || record.length) { record.push(field); if (record.some((f) => f !== "")) records.push(record); }
  const [header, ...body] = records;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** New rows join the sheet; a row already there (same key) keeps its mark. */
export function mergeRows(existing: SheetRow[], incoming: SheetRow[], key: (r: SheetRow) => string): SheetRow[] {
  const seen = new Set(existing.map(key));
  return [...existing, ...incoming.filter((r) => !seen.has(key(r)) && seen.add(key(r)))];
}

export const competitorKey = (r: SheetRow) => `${r.company_id}|${normalizeName(r.competitor)}`;
export const patentKey = (r: SheetRow) => `${r.company_id}|${r.publication}`;
export const roundKey = (r: SheetRow) => `${r.company_id}|${r.amount_usd}|${(r.date ?? "").slice(0, 7)}|${r.amount_usd ? "" : (r.round_type ?? "").toLowerCase()}`;

const normalizeName = (n: string) => (n ?? "").toLowerCase().replace(/,?\s*\b(inc|llc|ltd|limited|corp|corporation|gmbh|plc|co)\b\.?$/, "").replace(/[^\p{L}\p{N}]/gu, "");

export type MarkResult = { applied: number; unmarked: number; unreadable: string[] };

/** true / false for a mark, null when the row is not marked yet, "unreadable" for anything else. */
function readMark(mark: string): boolean | null | "unreadable" {
  const m = mark.trim().toLowerCase();
  if (!m) return null;
  if (MARK_YES.has(m)) return true;
  if (MARK_NO.has(m)) return false;
  return "unreadable";
}

/** Marked competitors into golden.competitors: "נכון" → names, "לא נכון" → not_competitors. */
export function applyCompetitorMarks(companies: GoldenCompany[], rows: SheetRow[]): MarkResult {
  const result: MarkResult = { applied: 0, unmarked: 0, unreadable: [] };
  for (const r of rows) {
    const verdict = readMark(r.mark ?? "");
    if (verdict === null) { result.unmarked++; continue; }
    if (verdict === "unreadable") { result.unreadable.push(`${r.company}: ${r.competitor} — "${r.mark}"`); continue; }
    const g = companies.find((c) => c.id === r.company_id);
    if (!g) { result.unreadable.push(`unknown company_id ${r.company_id}`); continue; }
    g.competitors ??= { names: [], not_competitors: [], confidence: "verified" };
    const list = verdict ? g.competitors.names : (g.competitors.not_competitors ??= []);
    const other = verdict ? (g.competitors.not_competitors ?? []) : g.competitors.names;
    const same = (n: string) => normalizeName(n) === normalizeName(r.competitor);
    for (let i = other.length - 1; i >= 0; i--) if (same(other[i])) other.splice(i, 1);   // the owner changed a mark
    if (!list.some(same)) list.push(r.competitor);
    if (verdict && r.source_url) (g.competitors.source_urls ??= []).includes(r.source_url) || g.competitors.source_urls!.push(r.source_url);
    result.applied++;
  }
  return result;
}

/**
 * Marked publications into golden.patents: "של החברה" → numbers. A company is
 * written only when every one of its rows is marked; none of its own → none.
 */
export function applyPatentMarks(companies: GoldenCompany[], rows: SheetRow[]): MarkResult & { companies: string[] } {
  const result: MarkResult & { companies: string[] } = { applied: 0, unmarked: 0, unreadable: [], companies: [] };
  const byCompany = new Map<string, SheetRow[]>();
  for (const r of rows) byCompany.set(r.company_id, [...(byCompany.get(r.company_id) ?? []), r]);
  for (const [id, list] of byCompany) {
    const verdicts = list.map((r) => ({ r, v: readMark(r.mark ?? "") }));
    const bad = verdicts.filter((x) => x.v === "unreadable");
    for (const x of bad) result.unreadable.push(`${x.r.company}: ${x.r.publication} — "${x.r.mark}"`);
    const open = verdicts.filter((x) => x.v === null).length;
    result.unmarked += open;
    if (open || bad.length) continue;   // a half-marked company would make a wrong "these are all its patents"
    const g = companies.find((c) => c.id === id);
    if (!g) { result.unreadable.push(`unknown company_id ${id}`); continue; }
    const own = verdicts.filter((x) => x.v === true && x.r.publication !== NO_PUBLICATIONS).map((x) => x.r.publication);
    const seen = new Set<string>();
    const numbers = own.filter((n) => !seen.has(patentDigits(n)) && seen.add(patentDigits(n)));
    g.patents = { numbers, ...(numbers.length === 0 ? { none: true } : {}), confidence: "verified", source_url: "https://worldwide.espacenet.com", notes: "EPO register (DOCDB) — ownership marked by the owner" };
    result.applied += list.length;
    result.companies.push(g.name);
  }
  return result;
}

/** Marked rounds: "נכון" → a verified golden round (the source the owner checked); "לא נכון" stays a wrong write. */
export function applyRoundMarks(companies: GoldenCompany[], rows: SheetRow[]): MarkResult {
  const result: MarkResult = { applied: 0, unmarked: 0, unreadable: [] };
  for (const r of rows) {
    const verdict = readMark(r.mark ?? "");
    if (verdict === null) { result.unmarked++; continue; }
    if (verdict === "unreadable") { result.unreadable.push(`${r.company}: ${r.round_type} ${r.amount_usd} ${r.date} — "${r.mark}"`); continue; }
    const g = companies.find((c) => c.id === r.company_id);
    if (!g) { result.unreadable.push(`unknown company_id ${r.company_id}`); continue; }
    result.applied++;
    if (!verdict) continue;
    const amount = r.amount_usd ? Number(r.amount_usd) : null;
    const rounds = (g.funding_rounds ??= []);
    if (rounds.some((x) => x.amount_usd === amount && (x.date ?? "").slice(0, 7) === (r.date ?? "").slice(0, 7))) continue;
    rounds.push({ type: r.round_type, amount_usd: amount, date: r.date || null, lead_investor: r.lead_investor || null, confidence: "verified", ...(r.source_url ? { source_url: r.source_url } : {}) });
  }
  return result;
}
