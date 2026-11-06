/**
 * lib/enrichment/markQuotes.ts — the quote that came with a marked value (owner, 2026-11-06). The tracker
 * keeps the value and its source, not its quote; the review runs' files (field_review/run_N.csv,
 * batch_N.csv) keep all of them. A value is found there by company, field, value and source. Pure.
 */
import type { Mark } from "./fieldReview";

const clean = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const quoteKey = (company: string, field: string, value: string, sourceUrl: string) => [company, field, value, sourceUrl].map(clean).join("|");

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
  }
  return into;
}

export const quoteOf = (m: Pick<Mark, "company" | "field" | "value" | "source_url">, quotes: Map<string, string>): string | null =>
  quotes.get(quoteKey(m.company, m.field, m.value, m.source_url ?? "")) ?? null;
