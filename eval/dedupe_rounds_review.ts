#!/usr/bin/env node
/**
 *   npx tsx eval/dedupe_rounds_review.ts               # report only
 *   WRITE=true npx tsx eval/dedupe_rounds_review.ts    # rewrites eval/review/rounds_review.csv
 * One real round reached the sheet twice (an earlier run without a date, a later one without an
 * amount): the unmarked duplicates go, the marked rows and the fuller row stay (reviewSheet.ts).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseCsv, toCsv, dedupeRoundRows, ROUND_COLUMNS } from "./reviewSheet.ts";

const file = join(dirname(fileURLToPath(import.meta.url)), "review", "rounds_review.csv");
if (!existsSync(file)) { console.error(`${file} not found`); process.exit(1); }
const rows = parseCsv(readFileSync(file, "utf8"));
const kept = dedupeRoundRows(rows);
for (const r of rows.filter((x) => !kept.includes(x))) console.log(`  − ${r.company}: ${r.round_type} ${r.amount_usd || "(no amount)"} ${r.date || "(no date)"} — ${r.source_url}`);
console.log(`${rows.length} rows, ${rows.length - kept.length} duplicate(s) removed, ${kept.length} left.`);
if (process.env.WRITE !== "true") { console.log("Report only. WRITE=true rewrites the sheet."); process.exit(0); }
writeFileSync(file, toCsv(ROUND_COLUMNS, kept));
console.log(`📝  ${file} updated.`);
