#!/usr/bin/env node
/**
 *   npx tsx eval/apply_manual_rounds.ts               # report only
 *   WRITE=true npx tsx eval/apply_manual_rounds.ts    # updates eval/golden_set.json
 * Run it AFTER eval/import_review.ts: a round the review sheet already added (without a date) is
 * completed here, not added a second time.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { applyManualRounds, MANUAL_ROUNDS } from "./manualRounds.ts";
import type { GoldenSet } from "./score.ts";

const path = join(dirname(fileURLToPath(import.meta.url)), "golden_set.json");
const golden: GoldenSet = JSON.parse(readFileSync(path, "utf8"));
const { companies, report } = applyManualRounds(golden.companies, MANUAL_ROUNDS);
console.log(report.join("\n"));
if (process.env.WRITE !== "true") { console.log("\nReport only. WRITE=true updates the golden set."); process.exit(0); }
golden.companies = companies;
writeFileSync(path, JSON.stringify(golden, null, 2) + "\n");
console.log(`\n📝  ${path} updated.`);
