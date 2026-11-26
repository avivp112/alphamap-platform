#!/usr/bin/env node
/**
 * scripts/rebuild_marks.ts — the marks the owner gave batch 8's first sample, kept for good (sample_marks.json; owner, 2026-11-19: a value marked before is not shown again).
 * The first sample file was overwritten by later lint runs. It is rebuilt from the report of the first run (archive/batch8_first/pilot_report_dry.csv) with the same seed:
 *   PILOT_REPORT=archive/batch8_first/pilot_report_dry.csv SAMPLE_FILE=sample_first.csv BATCH_NO=8 npx tsx scripts/report_lint.ts
 * and checked against the eleven wrong values the owner named, by their numbers: if every number is the company and field it was, the rebuild is the sample he marked, and every other row of it was
 * marked correct. If not, only the wrong values are kept (found by company and field), and it says so.
 *   BATCH=8 npx tsx scripts/rebuild_marks.ts
 */
import { readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";
import { saveMarks } from "../lib/enrichment/batchProcess.ts";

const batch = Number(process.env.BATCH ?? 8);
const file = process.env.SAMPLE_FIRST ?? "sample_first.csv";
// [number in the marked sample, company, field, a part of the value (optional), why it is wrong]
const WRONG: Array<[number, string, string, string, string]> = [
  [9, "WebBank", "competitor_declared", "", "the rival comes from a sentence about Klarna"],
  [16, "KtoMaLek", "tags", "", "a consumer drug search, not Healthcare IT"],
  [18, "Kry", "leader", "", "VP Corporate Affairs is not senior management"],
  [28, "lawhive", "office", "", "a registered address is no office"],
  [34, "Smarter Contracts", "hq_country", "", "a registered address is no headquarters"],
  [35, "Smarter Contracts", "hq_city", "", "a registered address is no headquarters"],
  [42, "DataGateway", "news", "", "the address says 20200714, not 2019-10-15"],
  [47, "Smarter Contracts", "founded_year", "", "the site says 2018 and another source 2019"],
  [48, "FindMe", "competitor_declared", "Concorrentes", "a word, not a company"],
  [49, "FindMe", "tags", "", "security team management, not Industrial Automation"],
  [60, "Zro", "employee_range", "", "a plus 150 does not prove 51-200"],
];
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const [h, ...b] = parseCsv(readFileSync(file, "utf8").replace(/\r(?!\n)/g, ""));
const ix = (c: string) => h.findIndex((x) => x === c);
const rows = b.map((r) => ({ n: Number(r[ix("n")]), company: r[ix("company")], field: r[ix("field")], value: r[ix("value")] }));
const bad = WRONG.filter(([n, co, f]) => { const r = rows.find((x) => x.n === n); return !r || fold(r.company) !== fold(co) || r.field !== f; });
console.log(`${rows.length} row(s) in ${file}`);
if (!bad.length) {
  const wrongNs = new Set(WRONG.map((w) => w[0]));
  saveMarks(rows.map((r) => ({ company: r.company, field: r.field, value: r.value, verdict: wrongNs.has(r.n) ? "wrong" as const : "correct" as const, reason: WRONG.find((w) => w[0] === r.n)?.[4] ?? "" })), batch);
  console.log(`✓ the rebuilt sample is the one the owner marked (all ${WRONG.length} numbers are their company and field): ${rows.length - WRONG.length} correct and ${WRONG.length} wrong marks kept in sample_marks.json.`);
} else {
  console.log(`⚠️  the rebuilt sample is NOT the same: ${bad.map(([n, co, f]) => `#${n} should be ${co} · ${f}, is ${rows.find((x) => x.n === n) ? `${rows.find((x) => x.n === n)!.company} · ${rows.find((x) => x.n === n)!.field}` : "missing"}`).join("; ")}`);
  const found = WRONG.flatMap(([, co, f, part, why]) => { const r = rows.find((x) => fold(x.company) === fold(co) && x.field === f && (!part || fold(x.value).includes(fold(part)))); return r ? [{ company: r.company, field: r.field, value: r.value, verdict: "wrong" as const, reason: why }] : []; });
  saveMarks(found, batch);
  console.log(`Only the ${found.length} wrong value(s) found by company and field are kept; the correct ones cannot be recovered and will be shown again.`);
}
