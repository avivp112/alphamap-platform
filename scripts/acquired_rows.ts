#!/usr/bin/env node
/**
 * scripts/acquired_rows.ts — for named companies, the acquired row and the news rows about the purchase, from the reviewed report and from the check's own report side by side (READS ONLY, free).
 *   REVIEWED=batch9_dry_report.csv NOW=regression/out/acquired_9/pilot_report.csv npx tsx scripts/acquired_rows.ts Buildium Enso Rhebo Qnami
 */
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
const files: Array<[string, string]> = [["REVIEWED", process.env.REVIEWED ?? "batch9_dry_report.csv"], ["NOW", process.env.NOW ?? "regression/out/acquired_9/pilot_report.csv"]];
const names = process.argv.slice(2).map((x) => x.toLowerCase());
if (!names.length) { console.error("usage: acquired_rows.ts <company…>"); process.exit(2); }
for (const n of process.argv.slice(2)) {
  console.log(`\n════ ${n}`);
  for (const [label, f] of files) {
    if (!existsSync(f)) { console.log(`  ${label}: ${f} missing`); continue; }
    const [h, ...b] = parseCsv(readFileSync(f, "utf8").replace(/^﻿/, ""));
    const ix = (c: string) => h.indexOf(c);
    const rows = b.filter((r) => (r[ix("company")] ?? "").toLowerCase() === n.toLowerCase() && (r[ix("field")] === "acquired" || (r[ix("field")] === "news" && /acqui|buy|bought|merge|takes over|joins|to join/i.test(r[ix("after")] ?? ""))));
    console.log(`  ${label} (${f}): ${rows.length} row(s)`);
    for (const r of rows) console.log(`    ${r[ix("field")]}: ${(r[ix("after")] ?? "").slice(0, 170)}\n       ← ${r[ix("source_url")]}\n       "${(r[ix("quote")] ?? "").replace(/\s+/g, " ").slice(0, 170)}"`);
  }
}
