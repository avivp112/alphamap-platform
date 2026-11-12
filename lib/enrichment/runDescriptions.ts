/**
 * lib/enrichment/runDescriptions.ts — the latest stored description of each company in field_review/run_N.csv (the highest N wins),
 * with the source it was built from. Shared by the sector rejudge and the marking of its new values.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseCsvText } from "./fieldReview.ts";

export interface StoredDescription { value: string; source_url: string }

export function latestDescriptions(dir = "field_review"): Map<string, StoredDescription> {
  const out = new Map<string, StoredDescription>();
  if (!existsSync(dir)) return out;
  const runs = readdirSync(dir).map((f) => f.match(/^run_(\d+)\.csv$/)).filter((x): x is RegExpMatchArray => !!x).sort((a, b) => Number(a[1]) - Number(b[1]));
  for (const r of runs) {
    const rows = parseCsvText(readFileSync(`${dir}/${r[0]}`, "utf8").replace(/^﻿/, ""));
    const head = rows.shift() ?? [];
    const col = (n: string) => head.indexOf(n);
    for (const row of rows) if (row[col("field")] === "description" && row[col("value")]) out.set(row[col("company")], { value: row[col("value")], source_url: row[col("source_url")] ?? "" });
  }
  return out;
}
