#!/usr/bin/env node
/**
 * scripts/review_sheet_more.ts — a second marking sheet from review runs already made, with no new run (owner, 2026-11-09). Reads
 * field_review/run_<N>.csv (all the values a run found) and the tracker; lists every value of the chosen fields that is not marked
 * yet, numbered x<runs>.<n>. No network, no keys, nothing written to the database.
 *
 *   RUNS=6,7 FIELDS=description,sector,tags,employee_history,founder_background,competitor_market npx tsx scripts/review_sheet_more.ts
 *
 * Then mark as always:  BATCH=field_review/run_67x_sample.csv WRONG=x67.3,x67.8 npx tsx scripts/mark_batch.ts
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseCsvText, readMarks } from "../lib/enrichment/fieldReview.ts";
import { unmarkedRows, type RunRow } from "../lib/enrichment/reviewMore.ts";
import { definitionLines } from "../lib/enrichment/reviewDefinitions.ts";
import type { Field } from "../lib/enrichment/reviewValues.ts";

const RUNS = (process.env.RUNS ?? "6,7").split(",").map((s) => s.trim()).filter(Boolean);
const FIELDS = (process.env.FIELDS ?? "description,sector,tags,employee_history,founder_background,competitor_market").split(",").map((s) => s.trim()).filter(Boolean);
const rows: RunRow[] = [];
for (const n of RUNS) {
  const path = `field_review/run_${n}.csv`;
  if (!existsSync(path)) { console.error(`${path} is not here — nothing to list for run ${n}.`); continue; }
  const [head, ...body] = parseCsvText(readFileSync(path, "utf8").replace(/^﻿/, ""));
  const at = (c: string) => head.indexOf(c);
  for (const r of body) if (r.length > 3) rows.push({ run: r[at("run")], company_id: r[at("company_id")], company: r[at("company")], field: r[at("field")], value: r[at("value")], on_file: r[at("on_file")] ?? "", source_url: r[at("source_url")] ?? "", quote: r[at("quote")] ?? "" });
}
const list = unmarkedRows(rows, readMarks(), FIELDS);
const tag = `${RUNS.join("")}x`;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
console.log(`\n${"═".repeat(62)}\nTo mark (runs ${RUNS.join(", ")}, not marked yet) — ${list.length} value(s) of ${FIELDS.join(", ")}\n`);
console.log(`What "correct" means:\n${definitionLines(FIELDS as Field[]).join("\n")}\n`);
let last = "", n = 0;
const sample: Array<RunRow & { id: string }> = [];
for (const v of list) {
  if (v.field !== last) { console.log(`[${v.field}]`); last = v.field; }
  n++; const id = `x${RUNS.join("")}.${n}`; sample.push({ ...v, id });
  console.log(`  ${id}  ${v.company}: ${v.value.slice(0, 220)}${v.field === "description" && v.on_file ? `\n        on file (${v.on_file.slice(0, 260)})` : ""}\n        source: ${v.source_url || "—"}${v.quote ? `\n        quote: "${v.quote.slice(0, 240)}"` : ""}`);
}
const out = `field_review/run_${tag}_sample.csv`;
writeFileSync(out, "﻿" + ["id,field,company,value,source_url,quote,company_id", ...sample.map((v) => [v.id, v.field, v.company, v.value, v.source_url, v.quote, v.company_id].map(cell).join(","))].join("\r\n") + "\r\n");
console.log(`\n📝  ${out} (the ${sample.length} to mark). Mark: BATCH=${out} WRONG=<ids, comma-separated> npx tsx scripts/mark_batch.ts`);
