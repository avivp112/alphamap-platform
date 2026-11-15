#!/usr/bin/env node
/**
 * scripts/known_sources_seed.ts — fills the memory of verified sources (cache/known_sources.json) from earlier dry-run reports (owner, round 10).
 * Only rows with a source address and a quote that are not marked wrong in eval/field_review_tracker.csv. Oldest report first, so the newest
 * value of a single-valued field wins.
 *
 *   npx tsx scripts/known_sources_seed.ts runs/dry_2.csv runs/dry_round8.csv pilot_report_dry.csv
 */
import { readFileSync, statSync, existsSync } from "fs";
import { basename } from "path";
import { loadKnown, saveKnown, remember, markKey, KNOWN_PATH, type ReportRow } from "../lib/enrichment/knownSources.ts";
import { readMarks } from "../lib/enrichment/fieldReview.ts";

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

const files = process.argv.slice(2).filter((f) => !f.startsWith("-"));
if (!files.length) { console.error("npx tsx scripts/known_sources_seed.ts <report.csv> [<report.csv> …]   (oldest first)"); process.exit(1); }
const store = loadKnown();
const wrong = new Set(readMarks().filter((m) => m.verdict === "wrong").map((m) => markKey(m.company, m.field, m.value)));
for (const f of files) {
  if (!existsSync(f)) { console.warn(`⚠️  ${f} not found — skipped`); continue; }
  const [head, ...body] = parseCsv(readFileSync(f, "utf8"));
  const ix = (n: string) => head.indexOf(n);
  const rows: ReportRow[] = body.map((r) => ({ company_id: r[ix("company_id")] ?? "", company: r[ix("company")] ?? "", field: r[ix("field")] ?? "", before: r[ix("before")] ?? "", after: r[ix("after")] ?? "", source_url: r[ix("source_url")] ?? "", quote: r[ix("quote")] ?? "", origin: ix("origin") >= 0 ? r[ix("origin")] : "" }));
  const date = statSync(f).mtime.toISOString().slice(0, 10);
  const added = remember(store, rows, basename(f), date, wrong);
  console.log(`${f}: ${rows.length} row(s), ${added} new value(s) remembered (dated ${date}).`);
}
saveKnown(store);
console.log(`📚 ${KNOWN_PATH}: ${Object.values(store).reduce((n, l) => n + l.length, 0)} value(s) of ${Object.keys(store).length} compan(ies).`);
