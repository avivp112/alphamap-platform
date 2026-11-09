#!/usr/bin/env node
/**
 *   ONLY=synthesia EVAL_LABEL=full56m npx tsx eval/add_competitor_rows.ts               # report only
 *   ONLY=synthesia EVAL_LABEL=full56m WRITE=true npx tsx eval/add_competitor_rows.ts    # adds the rows
 * The competitors v2 found for these companies in eval/v2_results_<label>.json join
 * eval/review/competitors_review.csv, unmarked (a name already there is not added twice). Then mark them:
 * SHEET=competitors npx tsx eval/review_sheet.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseCsv, toCsv, COMPETITOR_COLUMNS } from "./reviewSheet.ts";
import { competitorRowsFromRun } from "./competitorRows.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const label = (process.env.EVAL_LABEL ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!only.length) { console.error("Set ONLY=<golden id>[,<id>]."); process.exit(1); }
const runFile = join(dir, `v2_results${label ? `_${label}` : ""}.json`);
if (!existsSync(runFile)) { console.error(`${runFile} not found`); process.exit(1); }
const run = JSON.parse(readFileSync(runFile, "utf8")) as { per_company: Record<string, { output: { competitor_sources?: Array<{ name: string; source_url: string | null; quote: string | null }> } | null }> };
const golden = (JSON.parse(readFileSync(join(dir, "golden_set.json"), "utf8")).companies as Array<{ id: string; name: string }>);
const sheet = join(dir, "review", "competitors_review.csv");
const existing = existsSync(sheet) ? parseCsv(readFileSync(sheet, "utf8")) : [];
const added = only.flatMap((id) => {
  const g = golden.find((c) => c.id.toLowerCase() === id || c.name.toLowerCase() === id);
  if (!g) { console.log(`✗ ${id}: not in the golden set`); return []; }
  const rows = competitorRowsFromRun(g.id, g.name, run.per_company[g.id]?.output?.competitor_sources, existing);
  console.log(`${g.name}: ${rows.length} competitor(s) to add — ${rows.map((r) => r.competitor).join(", ") || "none"}`);
  return rows;
});
if (process.env.WRITE !== "true") { console.log("\nReport only. WRITE=true adds them."); process.exit(0); }
mkdirSync(dirname(sheet), { recursive: true });
writeFileSync(sheet, toCsv([...COMPETITOR_COLUMNS], [...existing, ...added]));
console.log(`\n📝  ${added.length} row(s) added to ${sheet}. Mark them: SHEET=competitors npx tsx eval/review_sheet.ts`);
