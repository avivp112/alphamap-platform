/**
 * lib/enrichment/markQuotes.ts — the quote that came with a marked value (owner, 2026-11-06). The tracker
 * keeps the value and its source, not its quote; the review runs' files (field_review/run_N.csv,
 * batch_N.csv) keep all of them. A value is found there by company, field, value and source. Pure.
 */
import type { Mark } from "./fieldReview";

const clean = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const quoteKey = (company: string, field: string, value: string, sourceUrl: string) => [company, field, value, sourceUrl].map(clean).join("|");
/** The same value without its source: a mark from the owner's competitors sheet (g.c…) kept no source in the tracker. */
const looseKey = (company: string, field: string, value: string) => quoteKey(company, field, value, "");

/** Rows (header first) of a review run's or batch's csv: company, field, value, source_url and quote columns. */
export function quotesFromRows(rows: string[][], into: Map<string, string> = new Map()): Map<string, string> {
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = (n: string) => head.indexOf(n);
  const [c, f, v, s, q] = [at("company"), at("field"), at("value"), at("source_url"), at("quote")];
  if ([c, f, v, q].some((i) => i < 0)) return into;
  for (const r of rows.slice(1)) {
    const quote = (r[q] ?? "").trim();
    if (!quote) continue;
    const key = quoteKey(r[c] ?? "", r[f] ?? "", r[v] ?? "", s >= 0 ? r[s] ?? "" : "");
    if (!into.has(key)) into.set(key, quote);
    const loose = looseKey(r[c] ?? "", r[f] ?? "", r[v] ?? "");
    if (!into.has(loose)) into.set(loose, quote);
  }
  return into;
}

/** Rows (header first) of eval/review/competitors_review.csv: company, competitor, source_url, quote. */
export function quotesFromCompetitorSheet(rows: string[][], into: Map<string, string> = new Map()): Map<string, string> {
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const [c, x, s, q] = [head.indexOf("company"), head.indexOf("competitor"), head.indexOf("source_url"), head.indexOf("quote")];
  if ([c, x, q].some((i) => i < 0)) return into;
  for (const r of rows.slice(1)) {
    const quote = (r[q] ?? "").trim();
    if (!quote) continue;
    const strict = quoteKey(r[c] ?? "", "competitor", r[x] ?? "", s >= 0 ? r[s] ?? "" : "");
    if (!into.has(strict)) into.set(strict, quote);
    const loose = looseKey(r[c] ?? "", "competitor", r[x] ?? "");
    if (!into.has(loose)) into.set(loose, quote);
  }
  return into;
}

export const quoteOf = (m: Pick<Mark, "company" | "field" | "value" | "source_url">, quotes: Map<string, string>): string | null =>
  quotes.get(quoteKey(m.company, m.field, m.value, m.source_url ?? "")) ?? quotes.get(looseKey(m.company, m.field, m.value)) ?? null;
