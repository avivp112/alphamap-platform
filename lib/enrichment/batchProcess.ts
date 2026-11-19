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
