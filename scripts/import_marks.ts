#!/usr/bin/env node
/**
 * scripts/import_marks.ts — the marks the owner's reviewer gave a sample file, moved into sample_marks.json by company, field and value (owner, 2026-11-19: sample_marked_round1.csv).
 * A value marked before stays marked; a value marked wrong is never turned into correct. Then sample_50.csv is rewritten by report_lint, which prints how many values are NEW to mark.
 *   BATCH=8 MARKED=sample_marked_round1.csv npx tsx scripts/import_marks.ts
 */
import { readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { markKey, readMarks, saveMarks } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH ?? 8);
const file = process.env.MARKED ?? "sample_marked_round1.csv";
const [h, ...b] = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r(?!\n)/g, ""));
const col = (c: string) => { const e = h.findIndex((x) => x === c); return e >= 0 ? e : h.findIndex((x) => x.toLowerCase().startsWith(c)); };
const [iC, iF, iV, iD, iR] = [col("company"), col("field"), col("value"), col("verdict"), col("reason")];
if ([iC, iF, iV, iD].some((i) => i < 0)) { console.error(`${file}: needs the columns company, field, value, verdict (found: ${h.join(", ")})`); process.exit(2); }
const WRONG = /^\s*(wrong|w|x|✗|✘|no|שגוי|לא)/i, RIGHT = /^\s*(correct|right|ok|c|✓|✔|yes|נכון|כן)/i;
const marks = readMarks();
const out: Array<{ company: string; field: string; value: string; verdict: "correct" | "wrong"; reason: string }> = [];
let unknown = 0, kept = 0;
for (const r of b) {
  const v = r[iD] ?? "";
  const verdict = WRONG.test(v) ? "wrong" as const : RIGHT.test(v) ? "correct" as const : null;
  if (!verdict) { unknown++; if (v.trim()) console.log(`⚠️  verdict not understood: "${v}" (${r[iC]} · ${r[iF]})`); continue; }
  const old = marks[markKey(r[iC], r[iF], r[iV])];
  if (old?.verdict === "wrong" && verdict === "correct") { kept++; continue; }
  out.push({ company: r[iC], field: r[iF], value: r[iV], verdict, reason: (iR >= 0 ? r[iR] : "") || old?.reason || "" });
}
saveMarks(out, batch);
console.log(`${b.length} row(s) in ${file}: ${out.filter((x) => x.verdict === "correct").length} correct and ${out.filter((x) => x.verdict === "wrong").length} wrong marks stored by company, field and value (${kept} kept wrong, ${unknown} without a verdict).`);
console.log("Next: BATCH_NO=8 npx tsx scripts/report_lint.ts — it rewrites sample_50.csv and says how many values are NEW to mark.");
