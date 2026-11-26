#!/usr/bin/env node
/**
 * scripts/acceptance_check.ts — PASS / FAIL for every line of eval/acceptance_batch5.json against a report (owner, round 10). A report with a FAIL is not sent.
 *
 *   npx tsx scripts/acceptance_check.ts [pilot_report_dry.csv] [eval/acceptance_batch5.json]     (exit code 1 when anything fails; TODAY=YYYY-MM-DD for the run day)
 */
import { existsSync, readFileSync } from "fs";
import { rowsFromCsv, parseCsv, runAcceptance, renderAcceptance, type Check } from "../lib/enrichment/acceptance.ts";

/** The checks of a batch: the batch-independent ones (eval/acceptance_generic.json) and, when it exists, the batch's own (eval/acceptance_batch<N>.json); an id is checked once. */
export function specPathsFor(batchNo?: number): string[] {
  return ["eval/acceptance_generic.json", ...(batchNo ? [`eval/acceptance_batch${batchNo}.json`] : [])].filter((p) => existsSync(p));
}

export function acceptanceReport(reportPath: string, specPaths: string[] | string = ["eval/acceptance_batch5.json"], today = process.env.TODAY ?? new Date().toISOString().slice(0, 10)): { text: string; failed: number; blocked: Array<{ company: string; field: string; after: string; source_url: string; check: string; why: string }>; unblockable: string[] } {
  const rows = rowsFromCsv(readFileSync(reportPath, "utf8"));
  const notEnriched = existsSync("not_enriched.csv") ? parseCsv(readFileSync("not_enriched.csv", "utf8")).slice(1).map((r) => r[0]) : [];
  const seen = new Set<string>();
  const checks = (Array.isArray(specPaths) ? specPaths : [specPaths]).flatMap((p) => JSON.parse(readFileSync(p, "utf8")) as Check[]).filter((c) => !seen.has(c.id) && !!seen.add(c.id));
  const results = runAcceptance(checks, rows, notEnriched, today);
  const errors = results.filter((r) => !r.pass && r.severity === "error");
  const blocked = errors.flatMap((r) => (r.offenders ?? []).map((o) => ({ company: o.company, field: o.field, after: o.after, source_url: o.source_url, check: r.id, why: r.why })));
  // An ERROR with no row to point at (a value that is missing) blocks nothing: it is listed.
  const unblockable = errors.filter((r) => !(r.offenders ?? []).length).map((r) => `${r.id}: ${r.detail}`);
  return { text: renderAcceptance(results), failed: errors.length, blocked, unblockable };
}

if (process.argv[1]?.endsWith("acceptance_check.ts")) {
  const report = process.argv[2] ?? "pilot_report_dry.csv";
  if (!existsSync(report)) { console.error(`no report at ${report}`); process.exit(2); }
  const { text, failed } = acceptanceReport(report, process.argv[3] ? [process.argv[3]] : specPathsFor(Number(process.env.BATCH_NO) || 5));
  console.log(text);
  process.exit(failed ? 1 : 0);
}
