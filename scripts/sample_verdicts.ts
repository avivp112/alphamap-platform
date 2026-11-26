#!/usr/bin/env node
/**
 * scripts/sample_verdicts.ts — the sample check of a batch, in one step (owner, 2026-11-19).
 *   BATCH=8 npx tsx scripts/sample_verdicts.ts                     prints sample_50.csv, numbered, compact
 *   BATCH=8 WRONG=3,17=the title is at another company npx tsx scripts/sample_verdicts.ts   the numbers that are WRONG (an optional "=reason" each); none wrong: RIGHT_ALL=1
 * Then, per field: up to 5% wrong is fine — each wrong value is excluded by its content and written to pending_fixes.csv with its reason, and the rest is written; over 5%, only that field is held
 * (held_fields.csv) and the other fields are written. The file's verdict column is filled in. A wet run reads both files by itself.
 */
import { readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { addHeldFields, addPendingFixes, addToTrackRecord, clearHeld, fieldDecisions, markKey, readMarks, readTrackRecord, saveMarks, type SampleRow } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH ?? process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH=<the batch number> is required."); process.exit(2); }
const file = process.env.FILE ?? "sample_50.csv";
const [head, ...rows] = parseCsv(readFileSync(file, "utf8").replace(/\r(?!\n)/g, ""));
const ix = (c: string) => { const e = head.findIndex((h) => h === c); return e >= 0 ? e : head.findIndex((h) => h.startsWith(c)); };
const sample: SampleRow[] = rows.map((r) => ({ n: Number(r[ix("n")]), company: r[ix("company")], field: r[ix("field")], value: r[ix("value")] }));
const wrongEnv = (process.env.WRONG ?? "").trim();

if (!wrongEnv && !process.env.RIGHT_ALL && !process.env.WRONG_BY && !process.env.APPLY_MARKS) {
  // Values the owner asked to see whatever the sample holds (watch_values.csv): listed first, to be judged with the sample.
  try {
    const [wh, ...wr] = parseCsv(readFileSync("watch_values.csv", "utf8"));
    const w = wr.filter((r) => Number(r[wh.indexOf("batch")]) === batch);
    if (w.length) { console.log("WATCH (not in the numbering; if one is wrong, say so with pending_fixes.csv):"); for (const r of w) console.log(`  ${r[wh.indexOf("company")]} · ${r[wh.indexOf("field")]} · ${r[wh.indexOf("value")]} — ${r[wh.indexOf("reason")]}`); console.log(""); }
  } catch { /* none */ }
  const todo = rows.filter((r) => !(r[ix("verdict")] ?? "").trim());
  console.log(`${rows.length} value(s) in the sample: ${rows.length - todo.length} already marked (kept), ${todo.length} NEW to mark.\n`);
  for (const r of todo) {
    console.log(`#${r[ix("n")]}  ${r[ix("company")]} · ${r[ix("field")]} · ${r[ix("value")].slice(0, 120)}`);
    console.log(`     ${(r[ix("source_url")] || "").slice(0, 130)}`);
    if (r[ix("quote")]) console.log(`     "${r[ix("quote")].slice(0, 200)}"`);
  }
  console.log(`\n${todo.length} value(s) to mark. The WRONG ones:  BATCH=${batch} WRONG=<numbers, comma-separated; N=reason optional> npx tsx scripts/sample_verdicts.ts   (none wrong: RIGHT_ALL=1)`);
  process.exit(0);
}

const wrong = new Map<number, string>();
// Marks given before (the verdict column carries them, from sample_marks.json): a value marked wrong stays wrong.
{ const marks = readMarks(); for (const r of rows) if (/^wrong/i.test(r[ix("verdict")] ?? "")) wrong.set(Number(r[ix("n")]), marks[markKey(r[ix("company")], r[ix("field")], r[ix("value")])]?.reason || "marked wrong before"); }
// Marks by content, for a sample whose numbers are not at hand: WRONG_BY="Company|field|value part=reason; Company|field=reason" (the value part and the field are optional). Every row that matches is wrong.
{
  const fold = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  for (const part of (process.env.WRONG_BY ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const [spec, ...reason] = part.split("=");
    const [co, f, v] = spec.split("|").map((x) => x?.trim());
    const hits = sample.filter((r) => (!co || fold(r.company) === fold(co)) && (!f || (r.field === "description_what_only" ? "description" : r.field) === f) && (!v || fold(r.value).includes(fold(v))));
    if (!hits.length) console.log(`⚠️  no row of the sample matches "${spec}"`);
    for (const h of hits) wrong.set(h.n, reason.join("=").trim() || "wrong in the sample check");
  }
}
if (process.env.PREVIEW) {
  const extra = (wrongEnv ? wrongEnv.split(",") : []).length;
  console.log(`Marked wrong by content: ${wrong.size} row(s)${extra ? ` (+ the numbers of WRONG=)` : ""}:`);
  for (const [n, why] of [...wrong].sort((a, b) => a[0] - b[0])) { const r = sample.find((x) => x.n === n)!; console.log(`  #${n}  ${r.company} · ${r.field} · ${r.value.slice(0, 80)} — ${why}`); }
  console.log("\nNothing written. The same command without PREVIEW=1 writes (add the numbers of the rest with WRONG=…).");
  process.exit(0);
}
for (const part of wrongEnv.split(",").map((x) => x.trim()).filter(Boolean)) {
  const [n, ...reason] = part.split("=");
  const num = Number(n);
  if (!sample.some((r) => r.n === num)) { console.error(`⛔  #${n} is not in ${file} (1–${sample.length}).`); process.exit(1); }
  wrong.set(num, reason.join("=").trim() || "wrong in the sample check");
}
// Every mark is kept: the same value (company, field, value) in a later sample is not shown again — and the decision below is taken on ALL the values of this batch ever marked, not on this file alone.
const vi = ix("verdict");
// APPLY_MARKS=1: only the marks already kept (sample_marks.json) decide — the values of this file that nobody marked yet are left alone (not taken as correct).
const onlyMarks = !!process.env.APPLY_MARKS;
if (!onlyMarks) for (const r of rows) r[vi] = wrong.has(Number(r[ix("n")])) ? "wrong" : "correct";
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
if (!onlyMarks) writeFileSync(file, "﻿" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");
if (!onlyMarks) saveMarks(sample.map((r) => ({ company: r.company, field: r.field, value: r.value, verdict: wrong.has(r.n) ? "wrong" as const : "correct" as const, reason: wrong.get(r.n) ?? "" })), batch);
const allMarks = Object.values(readMarks()).filter((m) => m.batch === batch);
const sampleAll: SampleRow[] = allMarks.map((m, i) => ({ n: i + 1, company: m.company, field: m.field, value: m.value }));
const wrongAll = new Map<number, string>(allMarks.flatMap((m, i) => (m.verdict === "wrong" ? [[i + 1, m.reason] as [number, string]] : [])));

// The owner's rule (2026-11-19): errors in 1–5 companies → the wrong values (and their siblings by rule and source) are excluded and the field is written; held when the errors are in more than 5 companies,
// when the field has too few values to judge (under 5 in the sample AND under 30 in the track record), or when a dangerous field has an error of unknown cause. FORCE_WRITE / FORCE_HOLD carry the
// owner's decision for a field, printed with the rule's own verdict.
const split = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const forceWrite = split(process.env.FORCE_WRITE), forceHold = split(process.env.FORCE_HOLD);
const decisions = fieldDecisions(sampleAll, wrongAll, readTrackRecord(), batch).map((d) =>
  forceWrite.includes(d.field) ? { ...d, hold: false, why: d.hold ? `the owner decided: written (the rule says: ${d.why})` : d.why }
  : forceHold.includes(d.field) ? { ...d, hold: true, why: `the owner decided: held${d.why ? ` (${d.why})` : ""}` } : d);
// The record of what each field's samples found (field_track_record.json, committed).
addToTrackRecord(batch, decisions.map((d) => ({ field: d.field, total: d.total, wrong: d.wrongValues })));

const heldFields = new Set(decisions.filter((d) => d.hold).map((d) => d.field));
const fam = (f: string) => (f === "description_what_only" ? "description" : f);
addPendingFixes(sampleAll.filter((r) => wrongAll.has(r.n) && !heldFields.has(fam(r.field))).map((r) => ({ batch, company: r.company, field: r.field, value: r.value, reason: wrongAll.get(r.n)! })));
clearHeld(batch, "sample_50");   // a rebuild: the earlier rows of this check are replaced
addHeldFields(decisions.filter((d) => d.hold).map((d) => ({ batch, field: d.field, source: "sample_50", detail: `${d.wrongCompanies} compan(ies) with errors, ${d.total} in the sample — ${d.why}` })));

console.log(`${sampleAll.length} value(s) of batch ${batch} marked in all · ${wrongAll.size} wrong (${Math.round((wrongAll.size / Math.max(1, sampleAll.length)) * 100)}%)\n`);
for (const d of decisions) console.log(`${d.hold ? "⏸️  HELD    " : d.wrongValues ? "✂️  excluded" : "✅ ok      "}  ${d.field.padEnd(20)} ${d.wrongValues}/${d.total} wrong in ${d.wrongCompanies} compan(ies)${d.why ? `  — ${d.why}` : ""}`);
console.log(`\n${[...wrongAll.keys()].filter((n) => !heldFields.has(fam(sampleAll.find((r) => r.n === n)!.field))).length} value(s) → pending_fixes.csv · ${heldFields.size} field(s) → held_fields.csv${heldFields.size ? ` (${[...heldFields].join(", ")})` : ""}`);
