/**
 * lib/enrichment/fieldReview.ts — which fields are open for writing (owner,
 * 2026-11-02): a field opens when the owner has marked at least 20 of its
 * values and at least 90% of them are correct (a round: its amount and its
 * date). The marks live in eval/field_review_tracker.csv, filled from the
 * samples scripts/field_review.ts prints. Pure but for reading that file.
 */

import { existsSync, readFileSync } from "fs";
import { FIELD_COLUMNS } from "./writeUnits";

export const MIN_MARKED = 20;
export const MIN_CORRECT = 0.9;
export const TRACKER = "eval/field_review_tracker.csv";

/** A reviewed field → the startups column(s) the pilot writes for it (scalar fields only, for now). */
export { FIELD_COLUMNS };

export interface Mark { id: string; field: string; company: string; value: string; source_url: string; verdict: "correct" | "wrong"; source_of_mark: string }

export function parseCsvText(text: string): string[][] { return parseCsv(text); }

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

export const REJUDGED = "eval/sector_rejudged.csv";
export interface RejudgedRow { id: string; produced: boolean; now: string }
export function readRejudged(path = process.env.SECTOR_REJUDGED ?? REJUDGED): RejudgedRow[] {
  if (!existsSync(path)) return [];
  const [, ...rows] = parseCsv(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  return rows.map(([id, produced, now]) => ({ id, produced: produced === "yes", now: now ?? "" }));
}

/**
 * The new classifications nobody has reviewed (owner, 2026-11-10): when the classifier changes, the marks of the old values are not
 * evidence about the new ones. Each rejudged mark whose sector changed needs a mark of its company on the NEW value; until it has one the
 * sector field is not counted open.
 */
export function pendingSectorItems(rows: RejudgedRow[] = readRejudged(), marks: Array<Pick<Mark, "id" | "field" | "company" | "value">> = readMarks()): Array<{ id: string; company: string; now: string }> {
  const sector = marks.filter((m) => m.field === "sector");
  const companyOf = new Map(sector.map((m) => [m.id, m.company]));
  const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
  const seen = new Set<string>();
  const out: Array<{ id: string; company: string; now: string }> = [];
  for (const r of rows) {
    if (r.produced || !r.now) continue;
    const company = companyOf.get(r.id);
    if (!company || sector.some((m) => m.company === company && norm(m.value) === norm(r.now))) continue;
    const k = `${company}|${norm(r.now)}`;
    if (seen.has(k)) continue;           // one value, however many old marks changed to it
    seen.add(k);
    out.push({ id: r.id, company, now: r.now });
  }
  return out;
}
export const pendingSectorReviews = (rows?: RejudgedRow[], marks?: Array<Pick<Mark, "id" | "field" | "company" | "value">>): number => pendingSectorItems(rows, marks).length;

export interface FieldStatus { field: string; marked: number; correct: number; share: number | null; open: boolean; pending?: number }

/** Derived from the headcount history, never marked on their own (owner, 2026-11-12): they stand or fall with employee_history. */
export const DERIVED_FROM_HISTORY = ["employee_count", "employee_range"] as const;

/** Fields no longer collected or reviewed (owner, 2026-11-12: biographies). Their old marks stay in the tracker and count for nothing. */
export const RETIRED_FIELDS = ["founder_bio"] as const;

export function fieldStatus(marks: Mark[], pending: Record<string, number> = {}): FieldStatus[] {
  const all = fieldStatusOwn(marks.filter((m) => !(DERIVED_FROM_HISTORY as readonly string[]).includes(m.field) && !(RETIRED_FIELDS as readonly string[]).includes(m.field)), pending);
  const hist = all.find((s) => s.field === "employee_history") ?? { field: "employee_history", marked: 0, correct: 0, share: null, open: false, pending: 0 };
  return [...all, ...DERIVED_FROM_HISTORY.map((field) => ({ ...hist, field }))];
}

function fieldStatusOwn(marks: Mark[], pending: Record<string, number> = {}): FieldStatus[] {
  // "competitor", the tracker's field before the tiers (2026-11-07), is the declared tier.
  const fieldOf = (m: Mark) => (m.field === "competitor" ? "competitor_declared" : m.field);
  const fields = [...new Set(marks.map(fieldOf))];
  return fields.map((field) => {
    const mine = marks.filter((m) => fieldOf(m) === field);
    const correct = mine.filter((m) => m.verdict === "correct").length;
    const share = mine.length ? correct / mine.length : null;
    const waiting = pending[field] ?? 0;
    return { field, marked: mine.length, correct, share, pending: waiting, open: waiting === 0 && mine.length >= MIN_MARKED && share != null && share >= MIN_CORRECT };
  });
}

/** Fields waiting for the review of values a changed rule or classifier produced (sector, for now). */
export function pendingReviews(): Record<string, number> {
  const n = pendingSectorReviews();
  return n ? { sector: n } : {};
}

/** The startups columns open for writing by the review. */
export function openColumns(marks: Mark[] = countedMarks()): string[] {
  return fieldStatus(marks, pendingReviews()).filter((s) => s.open).flatMap((s) => FIELD_COLUMNS[s.field] ?? []);
}

/** The review fields open for writing: ≥20 marked, ≥90% correct, against the current rules. */
export function openFieldNames(marks: Mark[] = countedMarks()): string[] {
  return fieldStatus(marks, pendingReviews()).filter((s) => s.open).map((s) => s.field);
}

/** At most this many values of one company in a field's sample (owner, 2026-11-04: Constructor's patents). */
export const PER_COMPANY = 2;
export function capPerCompany<T extends { company_id: string }>(xs: T[], cap: number): T[] {
  const seen = new Map<string, number>();
  return xs.filter((x) => { const n = seen.get(x.company_id) ?? 0; if (n >= cap) return false; seen.set(x.company_id, n + 1); return true; });
}

// ── Replay: the marks counted against the current rules (owner, 2026-11-04) ──
// When a field's rules change, scripts/field_review_replay.ts re-runs the current collection on
// every marked company and records, for each mark, whether the current rules still produce its
// value. A mark whose value they no longer produce leaves the count; the others stay, correct or
// wrong. The status is always computed against the current rules.

export const REPLAY = "eval/field_review_replay.csv";

const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9$. ]+/g, " ").replace(/\s+/g, " ").trim();
const head = (s: string) => norm(s.split(/\s+[—:·]\s+|:\s/)[0] ?? s);
const numbers = (s: string) => (s.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/,/g, ""));

/** Whether two values of a review field are the same value (a re-derived one and a marked one). */
export function sameReviewValue(field: string, a: string, b: string): boolean {
  switch (field) {
    case "founded_year": case "employee_count": return numbers(a)[0] === numbers(b)[0];
    case "hq_city": case "hq_country": case "office": case "founding_country": case "competitor": case "competitor_declared": case "competitor_market": case "employee_range":
      return norm(a).split(",")[0].trim() === norm(b).split(",")[0].trim() || norm(a) === norm(b);
    case "founder": case "leader": case "board": case "founder_bio": return head(a) === head(b);
    case "patent": return (a.match(/^[A-Z]{2}\S+/)?.[0] ?? norm(a)) === (b.match(/^[A-Z]{2}\S+/)?.[0] ?? norm(b));
    case "news": {
      const t = (s: string) => norm(s.replace(/^(\d{4}-\d{2}-\d{2}|no date)\s+—\s+/, ""));
      const [x, y] = [t(a), t(b)];
      return x === y || x.startsWith(y.slice(0, 40)) || y.startsWith(x.slice(0, 40));
    }
    case "round": {
      // Type and amount; "amount not disclosed" matches only itself.
      const type = (s: string) => norm(s).split(/ \$| amount/)[0];
      const amt = (s: string) => s.match(/\$([\d.]+)\s*([MB])/i);
      const [ma, mb] = [amt(a), amt(b)];
      const usd = (m: RegExpMatchArray | null) => (m ? Number(m[1]) * (m[2].toUpperCase() === "B" ? 1e9 : 1e6) : null);
      const [ua, ub] = [usd(ma), usd(mb)];
      return type(a) === type(b) && (ua == null ? ub == null : ub != null && Math.abs(ua - ub) / ub < 0.02);
    }
    default: return norm(a) === norm(b);
  }
}

export interface ReplayRow { id: string; produced: boolean }

export function readReplay(path = process.env.FIELD_REVIEW_REPLAY ?? REPLAY): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (!existsSync(path)) return out;
  const [hd, ...rows] = parseCsv(readFileSync(path, "utf8").replace(/^\ufeff/, ""));
  const at = (n: string) => hd.indexOf(n);
  for (const r of rows) out.set(r[at("id")], r[at("produced")] === "yes");
  return out;
}

/** The marks the current rules still produce (none excluded while no replay has run). */
export function countedMarks(marks: Mark[] = readMarks(), replay: Map<string, boolean> = readReplay()): Mark[] {
  return marks.filter((m) => replay.get(m.id) !== false);
}

/** Rows of the tracker whose columns are not the seven (an unquoted comma shifts the verdict). */
export function malformedRows(path = process.env.FIELD_REVIEW_TRACKER ?? TRACKER): Array<{ line: number; id: string; columns: number }> {
  if (!existsSync(path)) return [];
  const [, ...rows] = parseCsv(readFileSync(path, "utf8").replace(/^\ufeff/, ""));
  return rows.map((r, i) => ({ line: i + 2, id: r[0], columns: r.length, verdict: r[5] })).filter((r) => r.columns !== 7 || !["correct", "wrong"].includes(r.verdict ?? ""));
}
