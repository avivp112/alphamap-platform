/**
 * lib/enrichment/batchProcess.ts — the batch process of the owner's 2026-11-19 update: one dry run, one sample check, one write per batch.
 *   pending_fixes.csv  a wrong value found in a check: excluded by content (company:field:value), with its reason; the rest of the batch is written. The fix to the rule comes before the next batch
 *                      and passes the regression gate; values already written and hurt are corrected in one clean-up every three batches.
 *   held_fields.csv    a field that failed its own acceptance checks, or whose sample error is over 5%: only that field is not written; the others are. A completion run every three batches.
 * Pure functions plus the two small files.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { parseCsv } from "./acceptance.ts";

export const ERROR_LIMIT = 0.05;
const q = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export interface PendingFix { batch: number; company: string; field: string; value: string; reason: string; created: string; status: string }
export interface HeldField { batch: number; field: string; source: string; detail: string; created: string; completed: string }
const PENDING_HEAD = ["batch", "company", "field", "value", "reason", "created", "status"];
const HELD_HEAD = ["batch", "field", "source", "detail", "created", "completed"];

function readRows(path: string): Array<Record<string, string>> {
  if (!existsSync(path)) return [];
  const [head, ...body] = parseCsv(readFileSync(path, "utf8"));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
function append(path: string, head: string[], rows: Array<Array<string | number>>): void {
  if (!rows.length) return;
  if (!existsSync(path)) writeFileSync(path, "﻿" + head.join(",") + "\r\n");
  appendFileSync(path, rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");
}

export function readPendingFixes(path = "pending_fixes.csv"): PendingFix[] {
  return readRows(path).map((r) => ({ batch: Number(r.batch), company: r.company, field: r.field, value: r.value, reason: r.reason, created: r.created, status: r.status || "open" }));
}
export function addPendingFixes(fixes: Array<Omit<PendingFix, "created" | "status">>, path = "pending_fixes.csv", now = new Date().toISOString().slice(0, 10)): void {
  const have = new Set(readPendingFixes(path).map((f) => `${f.batch}|${f.company}|${f.field}|${f.value}`));
  append(path, PENDING_HEAD, fixes.filter((f) => !have.has(`${f.batch}|${f.company}|${f.field}|${f.value}`)).map((f) => [f.batch, f.company, f.field, f.value, f.reason, now, "open"]));
}
/** The open fixes of a batch, as EXCLUDE entries by content ("Company:field:value"). */
export function pendingExcludes(batch: number, path = "pending_fixes.csv"): Array<{ company: string; field: string; value: string; token: string }> {
  return readPendingFixes(path).filter((f) => f.batch === batch && f.status !== "done").map((f) => ({ company: f.company, field: f.field, value: f.value, token: `${f.company}:${f.field}:${f.value}` }));
}

export function readHeldFields(path = "held_fields.csv"): HeldField[] {
  return readRows(path).map((r) => ({ batch: Number(r.batch), field: r.field, source: r.source, detail: r.detail, created: r.created, completed: r.completed ?? "" }));
}
export function addHeldFields(held: Array<Omit<HeldField, "created" | "completed">>, path = "held_fields.csv", now = new Date().toISOString().slice(0, 10)): void {
  const have = new Set(readHeldFields(path).filter((h) => !h.completed).map((h) => `${h.batch}|${h.field}`));
  const fresh = held.filter((h, i) => !have.has(`${h.batch}|${h.field}`) && held.findIndex((x) => x.batch === h.batch && x.field === h.field) === i);
  append(path, HELD_HEAD, fresh.map((h) => [h.batch, h.field, h.source, h.detail, now, ""]));
}
/** The fields a batch holds back, not yet completed. */
export function heldFieldsOf(batch: number, path = "held_fields.csv"): string[] {
  return [...new Set(readHeldFields(path).filter((h) => h.batch === batch && !h.completed).map((h) => h.field))];
}
/** Held fields of all batches still waiting for their completion run. */
export function outstandingHeld(path = "held_fields.csv"): HeldField[] { return readHeldFields(path).filter((h) => !h.completed); }

// ── the sample check: errors per field ───────────────────────────────────────────────────────────────────────────────────────────

export interface SampleRow { n: number; company: string; field: string; value: string }
export interface FieldError { field: string; total: number; wrong: number; share: number; held: boolean }
/** Per field: how many sampled values were wrong. Up to 5% is fine (the wrong ones are excluded and listed); over 5% holds that field. A field's `description_what_only` is a description. */
export function fieldErrors(sample: SampleRow[], wrong: Set<number>, limit = ERROR_LIMIT): FieldError[] {
  const by = new Map<string, { total: number; wrong: number }>();
  for (const r of sample) {
    const f = r.field === "description_what_only" ? "description" : r.field;
    const e = by.get(f) ?? by.set(f, { total: 0, wrong: 0 }).get(f)!;
    e.total++; if (wrong.has(r.n)) e.wrong++;
  }
  return [...by.entries()].map(([field, e]) => ({ field, ...e, share: e.wrong / e.total, held: e.wrong / e.total > limit })).sort((a, b) => b.share - a.share || a.field.localeCompare(b.field));
}

// ── the track record of a field: how many of its values were checked in samples, and how many were wrong ──────────────────────────────────────────────────────────────
export const MIN_HISTORY = 15;
export interface FieldRecord { reviewed: number; wrong: number; batches: number[] }
export type TrackRecord = Record<string, FieldRecord>;
export const familyOf = (f: string) => (f === "description_what_only" ? "description" : f);
export function readTrackRecord(path = "field_track_record.json"): TrackRecord {
  try { return JSON.parse(readFileSync(path, "utf8")) as TrackRecord; } catch { return {}; }
}
/** A batch's sample verdicts added to the record (once per batch: a second call for the same batch replaces its numbers, never doubles them). */
export function addToTrackRecord(batch: number, errors: Array<{ field: string; total: number; wrong: number }>, path = "field_track_record.json"): TrackRecord {
  const rec = readTrackRecord(path);
  const per = JSON.parse(readFileSync(path.replace(/\.json$/, "_by_batch.json"), { encoding: "utf8", flag: "a+" }) || "{}") as Record<string, Record<string, { total: number; wrong: number }>>;
  per[String(batch)] = Object.fromEntries(errors.map((e) => [familyOf(e.field), { total: e.total, wrong: e.wrong }]));
  writeFileSync(path.replace(/\.json$/, "_by_batch.json"), JSON.stringify(per, null, 1) + "\n");
  const out: TrackRecord = {};
  for (const [b, fields] of Object.entries(per)) for (const [f, v] of Object.entries(fields)) { const e = out[f] ?? (out[f] = { reviewed: 0, wrong: 0, batches: [] }); e.reviewed += v.total; e.wrong += v.wrong; e.batches.push(Number(b)); }
  void rec;
  writeFileSync(path, JSON.stringify(out, null, 1) + "\n");
  return out;
}
/** The fields (of these) with fewer than MIN_HISTORY checked values in all earlier samples: their sample is widened so that each has at least that many (or all of them). */
export function fieldsWithoutHistory(fields: string[], rec: TrackRecord = readTrackRecord(), min = MIN_HISTORY): string[] {
  return [...new Set(fields.map(familyOf))].filter((f) => (rec[f]?.reviewed ?? 0) < min);
}

/** Takes the pending fixes of a company's field out of the file (a value that was excluded by mistake). Returns how many. */
export function removePendingFix(batch: number, company: string, field: string, path = "pending_fixes.csv"): number {
  const fold = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const all = readPendingFixes(path);
  const keep = all.filter((f) => !(f.batch === batch && fold(f.company) === fold(company) && f.field === field));
  if (keep.length === all.length) return 0;
  writeFileSync(path, "\uFEFF" + PENDING_HEAD.join(",") + "\r\n");
  append(path, PENDING_HEAD, keep.map((f) => [f.batch, f.company, f.field, f.value, f.reason, f.created, f.status]));
  return all.length - keep.length;
}

// ── the owner's rule for a field after the sample check (2026-11-19) ──────────────────────────────────────────────────────────────────────────────────────────────
/** A field in which a wrong value is a wrong fact about the company itself: an error whose cause is unknown stops it. */
export const DANGEROUS_FIELDS = ["hq_city", "hq_country", "founder", "leader", "round", "founded_year", "employee_count"];
export const MAX_ERROR_COMPANIES = 5;
export const MIN_SAMPLE_VALUES = 5;
export const MIN_HISTORY_VALUES = 30;
export interface FieldDecision { field: string; total: number; wrongValues: number; wrongCompanies: number; sampleEnough: boolean; historyEnough: boolean; hold: boolean; why: string }
/**
 * Errors in 1–5 companies: the value itself (and its siblings by rule and source) is excluded and the field is written. The field is held when its errors are in more than 5 companies; when it has
 * too few values to judge (under 5 in the sample AND under 30 in the track record); or when it is a dangerous field and an error's cause is unknown (the mark carries no reason).
 */
export function fieldDecisions(sample: SampleRow[], wrong: Map<number, string>, record: TrackRecord = readTrackRecord(), batch?: number): FieldDecision[] {
  const by = new Map<string, { total: number; wrongValues: number; companies: Set<string>; unknownCause: boolean }>();
  for (const r of sample) {
    const f = familyOf(r.field);
    const e = by.get(f) ?? by.set(f, { total: 0, wrongValues: 0, companies: new Set(), unknownCause: false }).get(f)!;
    e.total++;
    if (wrong.has(r.n)) { e.wrongValues++; e.companies.add(r.company); if (!wrong.get(r.n) || /^wrong in the sample check$/.test(wrong.get(r.n)!)) e.unknownCause = true; }
  }
  return [...by.entries()].map(([field, e]) => {
    // the history before this batch (the record already holds this batch's numbers when it was run twice: they are taken out)
    const rec = record[field];
    const history = Math.max(0, (rec?.reviewed ?? 0) - (batch !== undefined && rec?.batches.includes(batch) ? e.total : 0));
    const sampleEnough = e.total >= MIN_SAMPLE_VALUES, historyEnough = history >= MIN_HISTORY_VALUES;
    const reasons: string[] = [];
    if (e.companies.size > MAX_ERROR_COMPANIES) reasons.push(`errors in ${e.companies.size} companies (more than ${MAX_ERROR_COMPANIES})`);
    if (!sampleEnough && !historyEnough) reasons.push(`too few values to judge (${e.total} in the sample, ${history} in the history)`);
    if (e.wrongValues && DANGEROUS_FIELDS.includes(field) && e.unknownCause) reasons.push("a dangerous field with an error of unknown cause");
    return { field, total: e.total, wrongValues: e.wrongValues, wrongCompanies: e.companies.size, sampleEnough, historyEnough, hold: reasons.length > 0, why: reasons.join("; ") };
  }).sort((a, b) => Number(b.hold) - Number(a.hold) || b.wrongCompanies - a.wrongCompanies || a.field.localeCompare(b.field));
}

/** Takes a batch's held-field rows of one source out of the file (a rebuild). Returns how many. */
export function clearHeld(batch: number, source: string, path = "held_fields.csv"): number {
  const all = readHeldFields(path);
  const keep = all.filter((h) => !(h.batch === batch && h.source === source));
  if (keep.length === all.length) return 0;
  writeFileSync(path, "\uFEFF" + HELD_HEAD.join(",") + "\r\n");
  append(path, HELD_HEAD, keep.map((h) => [h.batch, h.field, h.source, h.detail, h.created, h.completed]));
  return all.length - keep.length;
}

// ── marks already given: a value (company, field, value) marked before keeps its mark ──────────────────────────────────────────────────────────────────────────────
export interface Mark { company: string; field: string; value: string; verdict: "correct" | "wrong"; reason: string; batch: number }
const MARKS_FILE = "sample_marks.json";
const foldKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
export const markKey = (company: string, field: string, value: string) => `${foldKey(company)}|${familyOf(field)}|${foldKey(value).slice(0, 160)}`;
export function readMarks(path = MARKS_FILE): Record<string, Mark> { try { return JSON.parse(readFileSync(path, "utf8")) as Record<string, Mark>; } catch { return {}; } }
export function saveMarks(rows: Array<{ company: string; field: string; value: string; verdict: "correct" | "wrong"; reason: string }>, batch: number, path = MARKS_FILE): void {
  const m = readMarks(path);
  for (const r of rows) m[markKey(r.company, r.field, r.value)] = { company: r.company, field: r.field, value: r.value, verdict: r.verdict, reason: r.reason, batch };
  writeFileSync(path, JSON.stringify(m, null, 1) + "\n");
}
