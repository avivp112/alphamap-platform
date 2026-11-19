#!/usr/bin/env node
/**
 * scripts/sibling_scan.ts — siblings of the wrong values of a sample (owner, 2026-11-19): which OTHER values of the batch have the same fault? Every value of a report goes through today's row rules
 * (rowProblem: registered address as hq / office, a support-function VP as leader, a news date the address contradicts, …), plus one pattern the rules do not cover: a tag / hq / office whose quote does not
 * name the company. Run on the first report (the values the batch would have written before the rules) and on the current one (what still stands). Free, writes nothing.
 *   BATCH_NO=8 npx tsx scripts/sibling_scan.ts
 */
import { existsSync, readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { rowProblem } from "../lib/enrichment/rowRules.ts";

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const reports = [process.env.OLD_REPORT ?? "archive/batch8_first/pilot_report_dry.csv", process.env.PILOT_REPORT ?? "pilot_report_dry.csv"];
const today = new Date().toISOString().slice(0, 10);
const known = new Set<string>();
try { const [h, ...b] = parseCsv(readFileSync("pending_fixes.csv", "utf8")); for (const r of b) known.add(`${fold(r[h.indexOf("company")])}|${r[h.indexOf("field")]}`); } catch { /* none */ }
for (const file of reports) {
  if (!existsSync(file)) { console.log(`(${file} not found)`); continue; }
  const [h, ...b] = parseCsv(readFileSync(file, "utf8").replace(/\r(?!\n)/g, ""));
  const ix = (c: string) => h.indexOf(c);
  const hits: string[] = [];
  for (const r of b) {
    const company = r[ix("company")], field = r[ix("field")], after = r[ix("after")] ?? "", quote = r[ix("quote")] ?? "", url = r[ix("source_url")] ?? "";
    if (!after || field === "(nothing)") continue;
    let why = rowProblem({ company, field, after, source_url: url, quote }, company, today);
    if (!why && ["tags", "hq_city", "hq_country", "office"].includes(field) && quote && !fold(quote).includes(fold(company).slice(0, 6))) why = "its quote does not name the company";
    if (why) hits.push(`  ${company} · ${field} · ${after.slice(0, 70)} — ${why.slice(0, 120)}${known.has(`${fold(company)}|${field}`) ? "  (already in pending_fixes)" : ""}`);
  }
  console.log(`\n${file}: ${hits.length} value(s) that break a rule${hits.length ? ":" : " — none."}`);
  for (const x of hits) console.log(x);
}
