#!/usr/bin/env node
/**
 * scripts/report_company_ids.ts — the ids of the companies that have values in a dry report, comma-separated, for ONLY=<ids> of the wet run (owner, round 10).
 *   npx tsx scripts/report_company_ids.ts [pilot_report_dry.csv]
 */
import { readFileSync } from "fs";
import { parseCsv } from "../lib/enrichment/acceptance.ts";

const [head, ...body] = parseCsv(readFileSync(process.argv[2] ?? "pilot_report_dry.csv", "utf8"));
const ix = (n: string) => head.indexOf(n);
const ids = [...new Set(body.filter((r) => r[ix("field")] && r[ix("field")] !== "(nothing)").map((r) => r[ix("company_id")]).filter(Boolean))];
console.error(`${ids.length} company(ies) with values`);
console.log(ids.join(","));
