#!/usr/bin/env node
/**
 * eval/import_review.ts — the owner's marks into eval/golden_set.json
 * (eval/reviewSheet.ts): eval/review/competitors_review.csv,
 * eval/review/rounds_review.csv and eval/review/patents_review.csv, whichever exist. Unmarked rows wait for the
 * next import; an unreadable mark is listed and skipped.
 *
 *   npx tsx eval/import_review.ts
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseCsv, applyCompetitorMarks, applyPatentMarks, applyRoundMarks } from "./reviewSheet.ts";
import type { GoldenSet } from "./score.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(__dir, "golden_set.json");
const golden: GoldenSet = JSON.parse(readFileSync(goldenPath, "utf8"));

const competitors = join(__dir, "review", "competitors_review.csv");
const patents = join(__dir, "review", "patents_review.csv");
const rounds = join(__dir, "review", "rounds_review.csv");
if (!existsSync(competitors) && !existsSync(patents) && !existsSync(rounds)) { console.error("No review sheet in eval/review/ yet."); process.exit(1); }

if (existsSync(competitors)) {
  const r = applyCompetitorMarks(golden.companies, parseCsv(readFileSync(competitors, "utf8")));
  console.log(`Competitors: ${r.applied} mark(s) imported, ${r.unmarked} not marked yet.`);
  for (const u of r.unreadable) console.log(`  ⚠️  not understood: ${u}`);
}
if (existsSync(patents)) {
  const r = applyPatentMarks(golden.companies, parseCsv(readFileSync(patents, "utf8")));
  console.log(`Patents: ${r.companies.length} compan(ies) imported (${r.companies.join(", ") || "—"}); ${r.unmarked} row(s) not marked yet — a company is imported only once all its rows are marked.`);
  for (const u of r.unreadable) console.log(`  ⚠️  not understood: ${u}`);
}
if (existsSync(rounds)) {
  const r = applyRoundMarks(golden.companies, parseCsv(readFileSync(rounds, "utf8")));
  console.log(`Rounds: ${r.applied} mark(s) imported, ${r.unmarked} not marked yet.`);
  for (const u of r.unreadable) console.log(`  ⚠️  not understood: ${u}`);
}
writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
console.log("Wrote eval/golden_set.json.");
