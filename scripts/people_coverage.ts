/**
 * scripts/people_coverage.ts — people coverage (read only), today and with a review run's values (owner, 2026-11-10).
 *   RUN=9 npx tsx scripts/people_coverage.ts          # the companies of field_review/run_9.csv
 *   npx tsx scripts/people_coverage.ts                # a sample of 500 companies on file
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Writes nothing.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { coverage, withRunValues, type CompanyPeople } from "../lib/enrichment/peopleCoverage.ts";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(1); }
const db = createClient(url, key);
const RUN = process.env.RUN;

function csvRows(path: string): Array<Record<string, string>> {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const rows: string[][] = []; let cur: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { cur.push(cell); cell = ""; }
    else if (ch === "\n") { cur.push(cell.replace(/\r$/, "")); rows.push(cur); cur = []; cell = ""; } else cell += ch;
  }
  const head = rows.shift() ?? [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

let ids: string[] | null = null;
let runRows: Array<{ company_id: string; field: string; value: string }> = [];
if (RUN) {
  const path = `field_review/run_${RUN}.csv`;
  if (!existsSync(path)) { console.error(`${path} not found`); process.exit(1); }
  const rows = csvRows(path);
  runRows = rows.map((r) => ({ company_id: r.company_id, field: r.field, value: r.value }));
  ids = [...new Set(runRows.map((r) => r.company_id).filter(Boolean))];
}
const q = db.from("startups").select("id, name, founders, leadership");
const { data, error } = await (ids ? q.in("id", ids) : q.limit(500));
if (error) { console.error(error.message); process.exit(1); }
const onFile = (data ?? []) as CompanyPeople[];
const today = coverage(onFile);
const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
console.log(`People coverage — ${onFile.length} companies${RUN ? ` of run ${RUN}` : " (a sample on file)"}\n`);
const after = RUN ? coverage(withRunValues(onFile, runRows)) : null;
for (const [k, label] of [["founder", "at least one founder"], ["ceo", "a CEO among the leaders"], ["bio", "a biography"], ["background", "a founder background"]] as const) {
  console.log(`  ${label.padEnd(26)} today ${pct(today[k], today.n).padEnd(14)}${after ? `with the run ${pct(after[k], after.n)}` : ""}`);
}
