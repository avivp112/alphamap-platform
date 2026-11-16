/**
 * lib/enrichment/newsRounds.ts — a round from an accepted headline (owner, round 10): a news item that reports the company raising ("Humi Closes $31M Series B", "Mintifi raises
 * $180 million in funding") is a round: the amount and type are the headline's, the date is the news item's date, the headline is the quote. Only a headline whose subject is the
 * company counts; "plans to raise", a valuation, revenue or someone else's raise do not.
 */
import type { V2Round } from "./extractFunding.ts";
import type { LabeledSource } from "./sources.ts";
import { namesCompanyUpFront } from "./newsRelevance.ts";

const VERB = /\b(?:raises?|raised|closes?|closed|secures?|secured|lands|landed|scores?|scored|bags|bagged|nabs|snags|pulls in|receives|received|gets|got|announces?|announced)\b/i;
const NOT_A_RAISE = /\b(?:plans? to|to raise|seeks?|in talks|could|may|might|looking to|aims? to|hopes? to)\b/i;
const AMOUNT = /(?:USD\s*|US\s*)?([$€£])\s?(\d[\d.,]*)\s?(billion|million|mln|bn|mm|m|b|k)?\b/i;
const NOT_THE_RAISE_BETWEEN = /\b(?:valuation|valued|revenue|arr|sales|worth|customers|users)\b/i;
const STAGE = /\b(pre-?seed|seed|series\s+[a-h]\+?|growth round|bridge round)\b/i;

const MULT: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, mln: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

export function normalizeStage(s: string): string {
  const t = s.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^pre-?seed$/.test(t)) return "Pre-Seed";
  if (t === "seed") return "Seed";
  const m = t.match(/^series ([a-h])(\+?)$/);
  if (m) return `Series ${m[1].toUpperCase()}${m[2]}`;
  return /growth/.test(t) ? "Growth" : /bridge/.test(t) ? "Bridge" : "Other";
}

/** The round a headline reports for this company, or null. */
export function roundFromHeadline(title: string, companyName: string): { type: string; amount: number; quote: string } | null {
  const t = title.trim();
  if (!t || NOT_A_RAISE.test(t)) return null;
  const verb = t.match(VERB);
  if (!verb || verb.index == null) return null;
  // the company is the subject: named before the verb
  const before = t.slice(0, verb.index);
  if (!namesCompanyUpFront({ title: before, content: "" }, companyName)) return null;
  const after = t.slice(verb.index + verb[0].length);
  const m = after.match(AMOUNT);
  if (!m || m.index == null || m.index > 60) return null;
  if (NOT_THE_RAISE_BETWEEN.test(after.slice(0, m.index))) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = m[3]?.toLowerCase();
  const amount = Math.round(n * (unit ? MULT[unit] ?? 1 : 1));
  if (amount < 100_000) return null;
  // the same raise verb with a sum that is a valuation: "valuation soars to $850 million" is not read — only the first sum after the verb is
  const stage = t.slice(verb.index).match(STAGE);
  return { type: stage ? normalizeStage(stage[1]) : "Other", amount, quote: t };
}

/** V2 rounds for the accepted news items of a company. Each item is one round at most. */
export function roundsFromNews(news: Array<{ title: string; url: string; published_date?: string | null }>, companyName: string, sources: LabeledSource[]): V2Round[] {
  const out: V2Round[] = [];
  for (const n of news) {
    if (!n.published_date) continue;
    const src = sources.find((s) => s.url === n.url);
    if (!src) continue;
    const r = roundFromHeadline(n.title, companyName);
    if (!r) continue;
    out.push({
      round_type: r.type,
      amount_raised: { value: r.amount, source_id: src.source_id, evidence_quote: r.quote },
      announcement_date: { value: n.published_date, source_id: src.source_id, evidence_quote: r.quote },
      announcement_date_precision: "day",
      source_url: n.url,
    });
  }
  return out;
}
