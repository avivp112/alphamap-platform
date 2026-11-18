#!/usr/bin/env node
/**
 * scripts/rejected_review.ts — the owner's check of what the rules turned away (rejected_sample_30.csv), without editing a spreadsheet.
 *   npx tsx scripts/rejected_review.ts                  → prints the 30 rejections, numbered, each with its reason code, value, source and evidence
 *   SHOW=1,4,8 npx tsx scripts/rejected_review.ts      → only those numbers, in full (the whole reason and quote)
 *   WRONG=<the numbers> npx tsx scripts/rejected_review.ts  → those numbers are rejections that were WRONG (the value was right); every other number is a right rejection.
 *                                                         Writes the verdicts into the file and prints, per reason code, the share of wrong rejections (over 20% = widen the rule).
 */
import { readFileSync, writeFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { rejectionStats } from "../lib/enrichment/rejections.ts";

const file = process.env.FILE ?? "rejected_sample_30.csv";
const [head, ...rows] = parseCsv(readFileSync(file, "utf8"));
const ix = (c: string) => head.findIndex((h) => h.startsWith(c));
const wrongEnv = (process.env.WRONG ?? "").trim();
const only = new Set((process.env.SHOW ?? "").split(/[,\s]+/).filter(Boolean).map(Number));
if (!wrongEnv && !process.env.RIGHT_ALL) {
  for (const r of rows.filter((x) => !only.size || only.has(Number(x[ix("n")])))) {
    console.log(`#${r[ix("n")]}  ${r[ix("company")]} · ${r[ix("field")]} · ${r[ix("value")].slice(0, 110)}`);
    console.log(`     reason: ${r[ix("reason_code")]} — ${r[ix("reason")].slice(0, 170)}`);
    if (r[ix("source_url")]) console.log(`     source: ${r[ix("source_url")].slice(0, 150)}`);
    if (r[ix("evidence")]) console.log(`     quote:  ${r[ix("evidence")].slice(0, only.size ? 600 : 220)}`);
    if (only.size && r[ix("reason")].length > 170) console.log(`     (full reason) ${r[ix("reason")]}`);
    console.log("");
  }
  console.log(`Mark the WRONG rejections (the value was right):  WRONG=<numbers, comma-separated> npx tsx scripts/rejected_review.ts     (none wrong: RIGHT_ALL=1)`);
  process.exit(0);
}
const wrong = new Set(wrongEnv.split(/[,\s]+/).filter(Boolean).map(Number));
const bad = [...wrong].filter((n) => !Number.isInteger(n) || n < 1 || n > rows.length);
if (bad.length) { console.error(`⛔  numbers outside 1–${rows.length}: ${bad.join(", ")}`); process.exit(1); }
const vi = ix("verdict");
for (const r of rows) r[vi] = wrong.has(Number(r[ix("n")])) ? "wrong" : "right";
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(file, "﻿" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n");
const st = rejectionStats(rows.map((r) => ({ reason_code: r[ix("reason_code")], verdict: r[vi] })));
console.log(`${rows.length} marked · ${wrong.size} wrong rejection(s) (${Math.round((wrong.size / rows.length) * 100)}%)\n`);
for (const x of st) console.log(`${x.widen ? "❌ widen" : "✅ keep "}  ${x.reason_code.padEnd(34)} ${x.wrong}/${x.marked} wrong (${Math.round(x.share * 100)}%)`);
