/**
 * lib/enrichment/hints.ts — what a data platform says is a hint, never a fact
 * (owner, 2026-10-28). Dealroom, PremierAlts, Crunchbase and the rest
 * (dataPlatforms.ts) are not written as data, with or without their name
 * shown. A round that only a platform states — DarkOwl's "$8M Growth led by
 * Five Elms" (app.dealroom.co), BETA's $169M loan (Dealroom), SaveSage's $1M
 * Pre-Seed (premieralts.com) — instead:
 *
 *   1. starts a search for a primary source: a press release, an article,
 *      an SEC Form D, a company registry;
 *   2. found — a source that names the company and states the amount next to
 *      a raise — the round is written with that source alone (and then passes
 *      every rule a round passes: type stated, raiser named, ...);
 *   3. not found — it is kept as a hint in data_hints (migration
 *      20261110000000): the value, the platform URL, the date it was seen.
 *      Never shown on the site, never exported, not in the API; the next
 *      enrichment of the company searches for it again.
 *
 * Rounds first: amount, date, investors. Pure; collect.ts runs the searches,
 * writeCompany.ts stores the hints. Tested in hints.test.ts.
 */

import { extractNumbersFromText, normalizeForMatch } from "./evidence";
import { namesCompany } from "./headcount";
import { classifySourceType, type LabeledSource } from "./sources";
import { isListingSiteUrl } from "./dataPlatforms";
import type { V2Round } from "./extractFunding";

export interface RoundHint {
  round_type: string | null;
  amount_raised: number | null;
  announcement_date: string | null;
  lead_investor: string | null;
  /** The platform page the round was read on. */
  source_url: string | null;
  /** data_hints.id when the hint was stored by an earlier run. */
  id?: string;
}

/** One hint per round: the amount, and the month when there is a date. */
export function hintKey(h: Pick<RoundHint, "amount_raised" | "announcement_date" | "round_type">): string {
  return `round:${h.amount_raised ?? "?"}:${h.announcement_date?.slice(0, 7) ?? "?"}:${h.amount_raised == null ? normalizeForMatch(h.round_type ?? "") : ""}`;
}

export function hintFromRound(r: V2Round, sources: LabeledSource[]): RoundHint {
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  const cited = [r.amount_raised, r.lead_investor, r.announcement_date, r.valuation].map((e) => (e?.source_id ? byId.get(e.source_id)?.url : undefined));
  return {
    round_type: r.round_type ?? null,
    amount_raised: r.amount_raised?.value ?? null,
    announcement_date: r.announcement_date?.value ?? null,
    lead_investor: r.lead_investor?.value ?? null,
    source_url: r.source_url ?? cited.find((u): u is string => !!u) ?? null,
  };
}

/** "$8 million", "$1.5 billion", "$160,000" — how press releases write it. */
export function amountWords(n: number): string {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(2)} billion`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(2)} million`;
  return `$${n.toLocaleString("en-US")}`;
}

/** At most three searches per hint: the raise, the lead investor, an SEC Form D. */
export function hintQueries(companyName: string, h: RoundHint): Array<[string, string]> {
  const q: Array<[string, string]> = [];
  const type = h.round_type && !/^(unknown|other)$/i.test(h.round_type) ? ` "${h.round_type}"` : "";
  if (h.amount_raised != null) q.push(["hint_raise", `"${companyName}" raises "${amountWords(h.amount_raised)}"${type}`]);
  if (h.lead_investor) q.push(["hint_lead", `"${companyName}" "${h.lead_investor}" funding round`]);
  q.push(["hint_form_d", `site:sec.gov "${companyName}" "Form D"`]);
  return q;
}

const RAISE = /\b(rais(e|es|ed|ing)|secur(e|es|ed)|clos(e|es|ed)|lands|nabs|bags|announc\w* .{0,40}(funding|round|investment|financing)|funding|financing|investment|loan|credit facility)\b/i;
// What a Form D states: "Total Amount Sold $8,000,000".
const FORM_D_SOLD = /total\s+amount\s+sold[^\d$]{0,20}\$?\s?([\d,]+)/i;

const sentences = (text: string) => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
const nearAmount = (sentence: string, amount: number) => extractNumbersFromText(sentence).some((n) => Math.abs(n - amount) / amount < 0.01);

/** A source that may confirm a hint: not a data platform, not LinkedIn, not a review directory. */
function canConfirm(s: LabeledSource): boolean {
  const t = classifySourceType(s.url);
  return t !== "aggregator_snippet" && t !== "model_inferred" && !isListingSiteUrl(s.url);
}

/**
 * The hint as a round with a primary source, or null when none confirms it:
 * a source that names the company and, in one sentence, states the amount
 * beside a raise (or a Form D's "Total Amount Sold"). The lead investor is
 * kept only when the same source names it; the type and date are left to
 * the usual grounding (assemble.ts), which reads them from this source.
 */
export function confirmHint(h: RoundHint, sources: LabeledSource[], companyName: string): V2Round | null {
  if (h.amount_raised == null || h.amount_raised <= 0) return null;
  for (const s of sources) {
    if (!canConfirm(s)) continue;
    const text = `${s.title ?? ""}. ${s.content}`;
    if (!namesCompany(text, companyName)) continue;
    // A filing counts by what was sold, never by what was offered.
    let quote: string | undefined;
    if (classifySourceType(s.url) === "registry") {
      const sold = text.match(FORM_D_SOLD);
      if (sold && Math.abs(Number(sold[1].replace(/,/g, "")) - h.amount_raised) / h.amount_raised < 0.01) quote = sold[0];
    } else {
      quote = sentences(text).find((sen) => sen.length <= 400 && RAISE.test(sen) && nearAmount(sen, h.amount_raised!));
    }
    if (!quote) continue;
    const leadQuote = h.lead_investor ? sentences(text).find((sen) => sen.length <= 400 && normalizeForMatch(sen).includes(normalizeForMatch(h.lead_investor!))) : undefined;
    return {
      round_type: h.round_type ?? "Unknown",
      amount_raised: { value: h.amount_raised, source_id: s.source_id, evidence_quote: quote.trim() },
      ...(leadQuote ? { lead_investor: { value: h.lead_investor!, source_id: s.source_id, evidence_quote: leadQuote.trim() } } : {}),
      source_url: s.url,
    };
  }
  return null;
}
