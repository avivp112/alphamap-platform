#!/usr/bin/env node
/**
 * eval/originals_sheet.ts — check sheet for the original golden companies (owner, 2026-11-05).
 *
 *   npx tsx eval/originals_sheet.ts                       # prints the sheet, writes eval/originals_sheet.csv
 *   WRONG="v1.4=London,v1.17" WRITE=true npx tsx eval/originals_sheet.ts   # applies the verdict to golden_set.json
 *   (v1.4=London: the right value, kept; v1.17: no value, becomes "unknown")
 *
 * The quote is the sentence of the source page (read through Jina) that carries the value; where the
 * page cannot be read, the golden entry's own note, else "(none)". Nothing is written to the database.
 */
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { sheetValues, sheetText, sheetCsv, applyVerdict, type SheetValue } from "./originalsSheet.ts";
import type { GoldenSet } from "./score.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
if (existsSync(join(__dir, "..", ".env"))) config({ path: join(__dir, "..", ".env") });
const goldenPath = join(__dir, "golden_set.json");
const golden: GoldenSet = JSON.parse(readFileSync(goldenPath, "utf8"));

async function page(url: string): Promise<string> {
  try {
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers, signal: AbortSignal.timeout(30_000) });
    return res.ok ? await res.text() : "";
  } catch { return ""; }
}

/** The sentence of the page that carries the value (a person: the surname). */
export function quoteFor(text: string, v: Pick<SheetValue, "field" | "value">): string {
  const needle = (v.field === "founder" ? v.value.split(" (")[0].split(/\s+/).pop()! : v.value).toLowerCase();
  if (!needle || needle.length < 2) return "";
  const s = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).find((x) => x.toLowerCase().includes(needle));
  return s ? s.slice(0, 320).trim() : "";
}

(async () => {
  const base = sheetValues(golden.companies);
  if (process.env.WRONG !== undefined) {
    const { companies, unknown, wrongApplied } = applyVerdict(golden.companies, base, process.env.WRONG.split(","));
    if (unknown.length) { console.error(`Unknown numbers (nothing written): ${unknown.join(", ")}`); process.exit(1); }
    console.log(`${wrongApplied} value(s) marked wrong; every other value of the sheet is now reviewed.`);
    if (process.env.WRITE !== "true") { console.log("Report only. WRITE=true updates golden_set.json."); return; }
    golden.companies = companies;
    writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
    console.log(`📝  ${goldenPath} updated.`);
    return;
  }
  const pages = new Map<string, string>();
  const quotes: Record<string, string> = {};
  for (const v of base) {
    if (!v.source_url) continue;
    if (!pages.has(v.source_url)) pages.set(v.source_url, await page(v.source_url));
    const q = quoteFor(pages.get(v.source_url)!, v);
    if (q) quotes[v.id] = q;
  }
  const values = sheetValues(golden.companies, quotes);
  console.log(sheetText(values));
  writeFileSync("originals_sheet.csv", sheetCsv(values));
  console.log(`\n${values.length} values. Name the wrong ones; the rest are taken as correct. Sheet: originals_sheet.csv`);
})().catch((e) => { console.error(e); process.exit(1); });
