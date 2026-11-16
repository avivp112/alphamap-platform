#!/usr/bin/env node
/**
 * scripts/acceptance_check.ts — PASS / FAIL for every line of eval/acceptance_batch5.json against a report (owner, round 10). A report with a FAIL is not sent.
 *
 *   npx tsx scripts/acceptance_check.ts [pilot_report_dry.csv] [eval/acceptance_batch5.json]     (exit code 1 when anything fails; TODAY=YYYY-MM-DD for the run day)
 */
import { existsSync, readFileSync } from "fs";
import { rowsFromCsv, parseCsv, runAcceptance, renderAcceptance, type Check } from "../lib/enrichment/acceptance.ts";

export function acceptanceReport(reportPath: string, specPath = "eval/acceptance_batch5.json", today = process.env.TODAY ?? new Date().toISOString().slice(0, 10)): { text: string; failed: number } {
  const rows = rowsFromCsv(readFileSync(reportPath, "utf8"));
  const notEnriched = existsSync("not_enriched.csv") ? parseCsv(readFileSync("not_enriched.csv", "utf8")).slice(1).map((r) => r[0]) : [];
  const results = runAcceptance(JSON.parse(readFileSync(specPath, "utf8")) as Check[], rows, notEnriched, today);
  return { text: renderAcceptance(results), failed: results.filter((r) => !r.pass).length };
}

if (process.argv[1]?.endsWith("acceptance_check.ts")) {
  const report = process.argv[2] ?? "pilot_report_dry.csv";
  if (!existsSync(report)) { console.error(`no report at ${report}`); process.exit(2); }
  const { text, failed } = acceptanceReport(report, process.argv[3]);
  console.log(text);
  process.exit(failed ? 1 : 0);
}
