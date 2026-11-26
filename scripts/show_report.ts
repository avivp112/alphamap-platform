#!/usr/bin/env node
/**
 * scripts/show_report.ts — a dry report's rows of some fields, compact, for the owner's review before a wet run.
 *   FIELDS=tags,news,office npx tsx scripts/show_report.ts [report.csv]        (default pilot_report_dry.csv; COMPANY=<name> narrows to one company)
 */
import { readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const file = process.argv[2] ?? "pilot_report_dry.csv";
const [head, ...rows] = parseCsv(readFileSync(file, "utf8"));
const ix = (c: string) => { const e = head.findIndex((h) => h === c); return e >= 0 ? e : head.findIndex((h) => h.startsWith(c)); };
const fields = new Set((process.env.FIELDS ?? "").split(",").map((x) => x.trim()).filter(Boolean));
const company = (process.env.COMPANY ?? "").toLowerCase();
let n = 0;
for (const r of rows) {
  const f = r[ix("field")];
  if (fields.size && !fields.has(f)) continue;
  if (company && !r[ix("company")].toLowerCase().includes(company)) continue;
  n++;
  console.log(`${r[ix("company")]} · ${f} · ${r[ix("after")].slice(0, 140)}`);
  console.log(`     ${(r[ix("source_url")] || "").slice(0, 120)}`);
}
console.log(`\n${n} row(s)${fields.size ? ` of ${[...fields].join(", ")}` : ""} in ${file}`);
