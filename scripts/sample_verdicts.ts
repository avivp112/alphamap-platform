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
import { addHeldFields, addPendingFixes, addToTrackRecord, ERROR_LIMIT, fieldErrors, type SampleRow } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH ?? process.env.BATCH_NO);
if (!Number.isInteger(batch) || batch < 1) { console.error("BATCH=<the batch number> is required."); process.exit(2); }
const file = process.env.FILE ?? "sample_50.csv";
const [head, ...rows] = parseCsv(readFileSync(file, "utf8"));
const ix = (c: string) => { const e = head.findIndex((h) => h === c); return e >= 0 ? e : head.findIndex((h) => h.startsWith(c)); };
const sample: SampleRow[] = rows.map((r) => ({ n: Number(r[ix("n")]), company: r[ix("company")], field: r[ix("field")], value: r[ix("value")] }));
const wrongEnv = (process.env.WRONG ?? "").trim();

if (!wrongEnv && !process.env.RIGHT_ALL && !process.env.WRONG_BY) {
  // Values the owner asked to see whatever the sample holds (watch_values.csv): listed first, to be judged with the sample.
  try {
    const [wh, ...wr] = parseCsv(readFileSync("watch_values.csv", "utf8"));
    const w = wr.filter((r) => Number(r[wh.indexOf("batch")]) === batch);
    if (w.length) { console.log("WATCH (not in the numbering; if one is wrong, say so with pending_fixes.csv):"); for (const r of w) console.log(`  ${r[wh.indexOf("company")]} · ${r[wh.indexOf("field")]} · ${r[wh.indexOf("value")]} — ${r[wh.indexOf("reason")]}`); console.log(""); }
  } catch { /* none */ }
  for (const r of rows) {
    console.log(`#${r[ix("n")]}  ${r[ix("company")]} · ${r[ix("field")]} · ${r[ix("value")].slice(0, 120)}`);
    console.log(`     ${(r[ix("source_url")] || "").slice(0, 130)}`);
    if (r[ix("quote")]) console.log(`     "${r[ix("quote")].slice(0, 200)}"`);
  }
  console.log(`\n${rows.length} value(s). The WRONG ones:  BATCH=${batch} WRONG=<numbers, comma-separated; N=reason optional> npx tsx scripts/sample_verdicts.ts   (none wrong: RIGHT_ALL=1)`);
  process.exit(0);
}

const wrong = new Map<number, string>();
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
const errors = fieldErrors(sample, new Set(wrong.keys()));
// The record of what each field's samples found (field_track_record.json, committed): a field with no history gets a wider sample the next time (report_lint.ts).
addToTrackRecord(batch, errors);
const vi = ix("verdict");
for (const r of rows) r[vi] = wrong.has(Number(r[ix("n")])) ? "wrong" : "correct";
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(file, "﻿" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");

const heldFields = new Set(errors.filter((e) => e.held).map((e) => e.field));
// A held field is held whole: its wrong values need no list of their own. The wrong values of the other fields are excluded by content.
addPendingFixes(sample.filter((r) => wrong.has(r.n) && !heldFields.has(r.field === "description_what_only" ? "description" : r.field)).map((r) => ({ batch, company: r.company, field: r.field, value: r.value, reason: wrong.get(r.n)! })));
addHeldFields(errors.filter((e) => e.held).map((e) => ({ batch, field: e.field, source: "sample_50", detail: `${e.wrong}/${e.total} wrong (${Math.round(e.share * 100)}%), over ${ERROR_LIMIT * 100}%` })));

console.log(`${sample.length} value(s) · ${wrong.size} wrong (${Math.round((wrong.size / sample.length) * 100)}%)\n`);
for (const e of errors) console.log(`${e.held ? "⏸️  HELD    " : e.wrong ? "✂️  excluded" : "✅ ok      "}  ${e.field.padEnd(20)} ${e.wrong}/${e.total} wrong (${Math.round(e.share * 100)}%)`);
console.log(`\n${wrong.size - [...wrong.keys()].filter((n) => heldFields.has(sample.find((r) => r.n === n)!.field)).length} value(s) → pending_fixes.csv · ${heldFields.size} field(s) → held_fields.csv${heldFields.size ? ` (${[...heldFields].join(", ")})` : ""}`);
