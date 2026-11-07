#!/usr/bin/env node
/**
 *   SHEET=competitors npx tsx eval/review_sheet.ts                       # the unmarked rows, numbered
 *   SHEET=competitors ALL=true npx tsx eval/review_sheet.ts              # every row
 *   SHEET=competitors MARK="1-9=y,12=n" npx tsx eval/review_sheet.ts     # what would be marked (nothing written)
 *   SHEET=competitors MARK="1-9=y,12=n" WRITE=true npx tsx eval/review_sheet.ts
 * SHEET is competitors, patents, rounds or v1competitors. y / n become נכון / של החברה and לא נכון / לא של החברה on
 * import (npx tsx eval/import_review.ts). Nothing is written to the database.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseCsv, toCsv, COMPETITOR_COLUMNS, PATENT_COLUMNS, ROUND_COLUMNS } from "./reviewSheet.ts";
import { V1_COMPETITOR_COLUMNS, v1Precision } from "./v1Competitors.ts";
import { SHEET_FILES, parseMarkSpec, applySheetMarks, sheetListing, type Sheet } from "./sheetCli.ts";

const sheet = (process.env.SHEET ?? "") as Sheet;
if (!(sheet in SHEET_FILES)) { console.error("Set SHEET=competitors, patents, rounds or v1competitors."); process.exit(1); }
const file = join(dirname(fileURLToPath(import.meta.url)), "review", SHEET_FILES[sheet]);
if (!existsSync(file)) {
  console.error(`${file} does not exist yet.${sheet === "patents" ? " Make it first: npx tsx eval/patent_register_review.ts (needs EPO_OPS_KEY and EPO_OPS_SECRET)." : ""}`);
  process.exit(1);
}
const rows = parseCsv(readFileSync(file, "utf8"));
const unmarked = rows.filter((r) => !r.mark?.trim()).length;

if (process.env.MARK === undefined) {
  console.log(sheetListing(rows, sheet, process.env.ALL === "true"));
  if (sheet === "v1competitors") { const p = v1Precision(rows); if (p.marked) console.log(`\nv1's precision so far: ${p.right} right of ${p.marked} marked (${((p.share ?? 0) * 100).toFixed(0)}%).`); }
  console.log(`\n${rows.length} rows, ${unmarked} not marked. Mark by number: SHEET=${sheet} MARK="1-9=y,12=n" npx tsx eval/review_sheet.ts   (y = right, n = wrong; add WRITE=true to save)`);
  process.exit(0);
}
let marks;
try { marks = parseMarkSpec(process.env.MARK); } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
const r = applySheetMarks(rows, marks);
if (r.unknown.length) { console.error(`Row number(s) not in the sheet (1–${rows.length}): ${r.unknown.join(", ")} — nothing written.`); process.exit(1); }
console.log(`${r.applied} row(s) would be marked: ${[...marks].map(([n, v]) => `${n}=${v}`).join(" ")}`);
if (process.env.WRITE !== "true") { console.log("Report only. WRITE=true saves the marks."); process.exit(0); }
const columns = sheet === "competitors" ? COMPETITOR_COLUMNS : sheet === "patents" ? PATENT_COLUMNS : sheet === "v1competitors" ? V1_COMPETITOR_COLUMNS : ROUND_COLUMNS;
writeFileSync(file, toCsv([...columns], r.rows));
console.log(`📝  ${file} updated. Then: npx tsx eval/import_review.ts`);
