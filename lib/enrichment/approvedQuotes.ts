/**
 * lib/enrichment/approvedQuotes.ts — what an already approved quote also says (owner, round 10 / batch 6): a quote that passed verification for a round, a date or a lead
 * and contains "<City>-based <Company>" or "founded by / Founder <Full Name>" feeds the headquarters and the founders too, from the same source and the same page date.
 */
import type { LabeledSource } from "./sources";
import { hqStatementsIn, articleDate, type HqStatement } from "./headquarters";
import { foundersFromText, foundersFromMentions } from "./people";
import { namesCompany } from "./headcount";
import type { V2Round } from "./extractFunding";

export interface ApprovedQuote { quote: string; source: LabeledSource }

/** The verified evidence quotes of the rounds, each with the source it was found on. */
export function approvedQuotes(rounds: V2Round[], sources: LabeledSource[]): ApprovedQuote[] {
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  const out: ApprovedQuote[] = [];
  for (const r of rounds) for (const ev of [r.amount_raised, r.announcement_date, r.lead_investor, r.valuation]) {
    const src = ev ? byId.get(ev.source_id) : undefined;
    const quote = ev?.evidence_quote?.trim();
    if (src && quote && !out.some((o) => o.quote === quote && o.source.source_id === src.source_id)) out.push({ quote, source: src });
  }
  return out;
}

/** Headquarters statements from approved quotes: the quote says "<City>-based <Company>" / "headquartered in <City>" of this company. */
export function hqFromApprovedQuotes(quotes: ApprovedQuote[], companyName: string): HqStatement[] {
  const out: HqStatement[] = [];
  for (const { quote, source } of quotes) {
    const st = hqStatementsIn({ ...source, content: quote, title: "" }, companyName, { forceKind: "press", date: articleDate(source) });
    for (const s of st) if (!out.some((o) => o.city === s.city && o.source_id === s.source_id)) out.push(s);
  }
  return out;
}

const PERSON = "\\p{Lu}[\\p{L}'’.-]+(?:\\s+\\p{Lu}[\\p{L}'’.-]+){1,2}";

/** Founders an approved quote names: "founded in 2020 by A and B", "<Company> founder A", "Founder and CEO A said". */
export function foundersFromApprovedQuotes(quotes: ApprovedQuote[], companyName: string): Array<{ name: string; title: string; quote: string; url: string }> {
  const out: Array<{ name: string; title: string; quote: string; url: string }> = [];
  const add = (name: string, title: string, quote: string, url: string) => { if (!out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, title, quote, url }); };
  for (const { quote, source } of quotes) {
    if (!namesCompany(quote, companyName)) continue;
    for (const f of foundersFromText(quote, companyName, { url: source.url, title: source.title })) add(f.name, f.title, quote, source.url);
    for (const f of foundersFromMentions(quote, companyName)) add(f.name, f.title, quote, source.url);
    for (const m of quote.matchAll(new RegExp(`\\b((?:co-?\\s?)?founder)(?:\\s*(?:and|&)\\s*(?:CEO|chief executive(?: officer)?|CTO|chairman|MD))?,?\\s+(${PERSON})(?=\\s+(?:said|says|told|explains|explained|added|noted|will|has|is)\\b|[,.;]|$)`, "giu"))) {
      add(m[2].trim().replace(/[.,;]+$/, ""), /co-?\s?founder/i.test(m[1]) ? "Co-founder" : "Founder", quote, source.url);
    }
  }
  return out;
}
