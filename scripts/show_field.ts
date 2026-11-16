#!/usr/bin/env node
/**
 * scripts/show_field.ts — one field of a report, per company: value, source and quote (owner, round 10).
 *
 *   FIELD=founder npx tsx scripts/show_field.ts pilot_report_dry.csv
 *   FIELD=founder npx tsx scripts/show_field.ts runs/dry_batch5_run3.csv pilot_report_dry.csv      # the first is "before", the second "after"
 */
import { readFileSync, existsSync } from "fs";

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const field = process.env.FIELD ?? "founder";
const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!files.length) { console.error("FIELD=<field> npx tsx scripts/show_field.ts <report.csv> [<report.csv> …]"); process.exit(1); }
files.forEach((f, n) => {
  if (!existsSync(f)) { console.log(`(${f} not found)`); return; }
  const [head, ...body] = parseCsv(readFileSync(f, "utf8"));
  const ix = (k: string) => head.indexOf(k);
  const rows = body.filter((r) => r[ix("field")] === field);
  console.log(`\n==== ${files.length > 1 ? (n === 0 ? "BEFORE" : n === files.length - 1 ? "AFTER" : `STEP ${n}`) : "REPORT"}: ${f} — ${rows.length} ${field} value(s) of ${new Set(rows.map((r) => r[ix("company")])).size} compan(ies)`);
  for (const r of rows.sort((a, b) => a[ix("company")].localeCompare(b[ix("company")]))) {
    console.log(`  ${r[ix("company")]}: ${r[ix("after")].replace(/\s+/g, " ").slice(0, 70)}\n      source: ${r[ix("source_url")]}\n      quote:  ${(r[ix("quote")] || "(none)").replace(/\s+/g, " ").slice(0, 200)}`);
  }
});
