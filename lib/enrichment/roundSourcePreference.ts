/**
 * lib/enrichment/roundSourcePreference.ts — which source a round rests on, when it has several (owner, 2026-11-24: Lendo's Series B stood on einpresswire.com, a paid distribution page, while the company's
 * own press release says the same sentence). The order: the company's own site, then press and other pages, then a press wire, and a paid distribution service last. A field's source is changed only
 * to a source that holds the field's evidence quote word for word, so the quote still stands on the page it is shown with. Pure.
 */
import type { V2Round } from "./extractFunding.ts";
import type { LabeledSource } from "./sources.ts";
import { roundSourceStanding } from "./roundSources.ts";

const PAID = /(^|\.)(einpresswire|marketersmedia|yespress|openpr|prlog|send2press|newswire\.net|pr\.com|prweb|accesswire|accessnewswire|24-7pressrelease|pressat|issuewire|ein\.news)\./i;
const WIRE = /(^|\.)(prnewswire|businesswire|globenewswire)\.[a-z.]+$/i;

export function sourceRank(s: Pick<LabeledSource, "url" | "source_type">): number {
  let host = ""; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { return 1; }
  if (PAID.test(`${host}.`)) return 3;
  if (s.source_type === "company_site") return 0;
  if (WIRE.test(host)) return 2;
  return 1;
}

const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const FIELDS = ["amount_raised", "valuation", "announcement_date", "lead_investor"] as const;

const sentencesOf = (t: string): string[] => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 12 && x.length <= 320);
const LEAD_CUE = /\b(?:led by|co-?led|leading the round)\b/i;
/** The lead is named by a lead cue within a sentence's reach of the name — the test the rows' rule applies (rowRules.ts stripUngroundedLead). */
const namesLeadWithCue = (text: string, name: string): boolean => { const bare = name.replace(/\b(inc|ltd|llc|lp|llp|plc|gmbh|sa|ag|bv|co)\b\.?/gi, "").trim().toLowerCase(); const i = text.toLowerCase().indexOf(bare); return bare.length >= 2 && i >= 0 && (LEAD_CUE.test(text.slice(Math.max(0, i - 90), i + bare.length)) || LEAD_CUE.test(text.slice(i, i + bare.length + 40))); };
const trim0 = (n: number) => String(+n.toFixed(2));
/** The ways a source writes an amount ("$28 million", "28M", "US$28m"); the sentence must carry one of them. */
function amountForms(v: number): RegExp {
  const forms: string[] = [];
  if (v >= 1e9) forms.push(`${trim0(v / 1e9)}\\s?(?:billion|bn|b)`); else if (v >= 1e6) forms.push(`${trim0(v / 1e6)}\\s?(?:million|mn|m)`); else if (v >= 1e3) forms.push(`${trim0(v / 1e3)}\\s?(?:thousand|k)`);
  forms.push(String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",")); forms.push(String(v));
  return new RegExp(`(?:^|[^\\d.,])(?:${forms.join("|")})\\b`, "i");
}
/**
 * A sentence of the better source that carries the same fact as the field's own quote, when that source does not hold the quote word for word (a wire reprints a press release with a dateline and a changed
 * headline): the amount for an amount, the investor's name beside "led by" for a lead. Null for a date and for anything else — those move only with an exact quote.
 */
function sentenceForFact(field: (typeof FIELDS)[number], value: unknown, content: string, alsoNamesLead?: string): string | null {
  const sentences = sentencesOf(content);
  if (field === "amount_raised" || field === "valuation") {
    const v = Number(value); if (!(v > 0)) return null;
    const re = amountForms(v), says = (x: string) => re.test(x) && /rais|fund|invest|financ|series|seed|round|valuation|valued/i.test(x);
    for (let i = 0; i < sentences.length; i++) {
      if (!says(sentences[i])) continue;
      if (!alsoNamesLead || namesLeadWithCue(sentences[i], alsoNamesLead)) return sentences[i];
      // the lead in the next sentence ("…raised $28 million in a Series B round. The round was led by X."): the two sentences together are the quote
      const two = i + 1 < sentences.length ? `${sentences[i]} ${sentences[i + 1]}` : "";
      if (two && two.length <= 420 && namesLeadWithCue(two, alsoNamesLead)) return two;
    }
    return null;
  }
  if (field === "lead_investor") { const name = String(value ?? "").trim(); if (name.length < 3) return null; const low = name.toLowerCase(); return sentences.find((x) => x.toLowerCase().includes(low) && /\b(?:led by|co-?led|leading the round|lead investor)\b/i.test(x)) ?? null; }
  return null;
}

/** Moves each round field that rests on a worse source to a better source that holds its quote; returns what moved, for the log. */
export function preferBetterRoundSources(rounds: V2Round[], sources: LabeledSource[], companyName: string): string[] {
  const moved: string[] = [];
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  const text = new Map(sources.map((s) => [s.source_id, norm(`${s.title ?? ""} ${s.content ?? ""}`)]));
  for (const r of rounds) {
    // A lead that the round's other quotes name with a cue must still be named after the move (rowRules.ts takes a lead out when no quote of the round names it): then the amount moves only to a sentence that says both.
    const leadName = (r.lead_investor as { value?: string } | undefined)?.value;
    const otherQuotes = (["amount_raised", "valuation", "announcement_date"] as const).map((k) => (r[k] as { evidence_quote?: string } | undefined)?.evidence_quote ?? "");
    const leadGrounded = !!leadName && otherQuotes.some((q) => namesLeadWithCue(q, leadName));
    for (const f of FIELDS) {
      const e = r[f] as { source_id: string; evidence_quote: string } | undefined;
      const cur = e && byId.get(e.source_id);
      if (!e || !cur) continue;
      const rank = sourceRank(cur);
      if (rank === 0) continue;
      const q = norm(e.evidence_quote);
      if (q.length < 12) continue;
      const candidates = sources
        .filter((s) => s.source_id !== e.source_id && sourceRank(s) < rank && roundSourceStanding(s.url, { companyName, isCompanySite: s.source_type === "company_site", content: s.content }).kind === "allowed")
        .sort((a, b) => sourceRank(a) - sourceRank(b));
      // the same quote word for word, else a sentence of that source that carries the same fact (the quote then is that sentence: it is a substring of the page it is shown with)
      const exact = candidates.find((s) => (text.get(s.source_id) ?? "").includes(q));
      const byFact = exact ? null : candidates.map((s) => ({ s, sentence: sentenceForFact(f, (e as { value?: unknown }).value, `${s.title ?? ""}\n${s.content ?? ""}`, f !== "lead_investor" && leadGrounded ? leadName : undefined) })).find((x) => x.sentence);
      const better = exact ?? byFact?.s;
      if (!better) continue;
      moved.push(`${r.round_type} ${f}: ${cur.url} → ${better.url}${byFact ? " (same fact, the page's own sentence)" : ""}`);
      e.source_id = better.source_id;
      if (byFact?.sentence) e.evidence_quote = byFact.sentence;
      if (r.source_url && r.source_url === cur.url) r.source_url = better.url;
    }
  }
  return moved;
}
