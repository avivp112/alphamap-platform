#!/usr/bin/env node
/**
 * scripts/pilot_coverage.ts — coverage by field for a batch (owner, 2026-11-14): of the companies the run processed, how many would get a value
 * for each field. Reads pilot_report_dry.csv (or PILOT_REPORT=…) and not_enriched.csv; writes nothing, costs nothing.
 *
 *   npx tsx scripts/pilot_coverage.ts
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

const report = process.env.PILOT_REPORT ?? "pilot_report_dry.csv";
if (!existsSync(report)) { console.error(`${report} not found`); process.exit(1); }
const [head, ...body] = parseCsv(readFileSync(report, "utf8"));
const ci = (n: string) => head.indexOf(n);
const wrote = new Map<string, Set<string>>();     // field -> companies with a value
const companies = new Map<string, string>();      // id -> name
for (const r of body) { const id = r[ci("company_id")], f = r[ci("field")]; if (!id || !f) continue; companies.set(id, r[ci("company")]); (wrote.get(f) ?? wrote.set(f, new Set()).get(f)!).add(id); }
const notEnriched = new Set<string>();
if (existsSync("not_enriched.csv")) for (const r of parseCsv(readFileSync("not_enriched.csv", "utf8")).slice(1)) { notEnriched.add(r[0]); }
const processed = companies.size + [...notEnriched].filter((n) => ![...companies.values()].includes(n)).length;
const enriched = companies.size;
console.log(`Processed ${processed} · with at least one value ${enriched} · not enriched ${notEnriched.size}\n`);
console.log(`${"field".padEnd(24)} ${"companies".padStart(9)} ${"of processed".padStart(13)} ${"of enriched".padStart(12)}`);
for (const [f, set] of [...wrote.entries()].sort((a, b) => b[1].size - a[1].size)) {
  console.log(`${f.padEnd(24)} ${String(set.size).padStart(9)} ${(Math.round(1000 * set.size / processed) / 10 + "%").padStart(13)} ${(Math.round(1000 * set.size / Math.max(1, enriched)) / 10 + "%").padStart(12)}`);
}
