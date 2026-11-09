/**
 * lib/enrichment/roundDates.ts — a round's date when it comes from a press article only (owner, 2026-11-08).
 * An article can trail the announcement by days (SpaceNews dated Apex's seed 2022-10-27; the release was 2022-10-24).
 * So when the date is the dateline of a tier 2–4 press article — not a date its sentence states, not a company page,
 * a wire, an investor's site or the party's own release — the original release is searched for (the company's site,
 * a distribution service, an investor's site) and the day is taken from it. Not found: the date is kept at month
 * level (date_precision = month) and shown as a month. Pure: the search is injected.
 */
import type { V2Round } from "./extractFunding.ts";
import type { LabeledSource } from "./sources.ts";
import { classifySourceType } from "./sources.ts";
import { roundSourceStanding } from "./roundSources.ts";
import { dateInSentence } from "./evidence.ts";
import { hintFromRound, confirmHint, amountWords } from "./hints.ts";

const PRESS_WHY = /^tier[234]_press$/;

/** The round's date is a press article's dateline and nothing firmer says the day. */
export function pressOnlyDate(round: V2Round, sources: LabeledSource[], companyName: string): boolean {
  const d = round.announcement_date;
  if (!d?.value || !d.source_id) return false;
  const src = sources.find((s) => s.source_id === d.source_id);
  if (!src) return false;
  // A date its own sentence states ("on October 24") is the day; the article's header line ("Date: …", "Published
  // Time: …", a wire dateline) or a date read off its address is only when it was published.
  const quote = d.evidence_quote ?? "";
  const header = /^\s*(?:(?:Source|Date|Published(?: Time)?)\s*:|[A-Z][A-Za-z .,'-]+,\s+[A-Z][a-z]{2,9}\.? \d{1,2},? \d{4})/.test(quote);
  if (!header && dateInSentence(quote)) return false;
  const standing = roundSourceStanding(src.url, { isCompanySite: src.source_type === "company_site", leadInvestor: round.lead_investor?.value, content: src.content, headline: src.title, companyName });
  return standing.kind === "allowed" && PRESS_WHY.test(standing.why);
}

/** One query for the original release of a round: the company's site, the wires, an investor's site. */
export function originalReleaseQuery(round: V2Round, companyName: string, domain: string | null): string {
  const amount = round.amount_raised?.value;
  const parts = [`"${companyName}"`, amount ? `"${amountWords(amount)}"` : "funding", "announces"];
  const sites = ["prnewswire.com", "businesswire.com", "globenewswire.com", ...(domain ? [domain] : [])].map((d) => `site:${d}`).join(" OR ");
  return `${parts.join(" ")} (${sites})`;
}

const DAY = 86_400_000;
export type RoundDateResolution =
  | { kind: "original"; iso: string; quote: string; source: LabeledSource }
  | { kind: "month"; month: string };

/**
 * The day from the original release, or the month. `labelled` are the search results as sources. An original is a
 * tier-1 source (company site, wire, investor, the party's release) that names the company, states the amount beside a
 * raise and dates itself within a month before the article — never after it.
 */
export function resolveRoundDate(round: V2Round, labelled: LabeledSource[], articleSource: LabeledSource | undefined, companyName: string): RoundDateResolution {
  const articleIso = round.announcement_date!.value;
  const originals = labelled.filter((s) => {
    const st = roundSourceStanding(s.url, { isCompanySite: s.source_type === "company_site", leadInvestor: round.lead_investor?.value, content: s.content, headline: s.title, companyName });
    return st.kind === "allowed" && st.tier === 1;
  });
  const confirmed = originals.length ? confirmHint(hintFromRound(round, originals), originals, companyName) : null;
  const iso = confirmed?.announcement_date?.value;
  if (confirmed && iso) {
    const gap = (Date.parse(articleIso) - Date.parse(iso)) / DAY;
    const source = originals.find((s) => s.source_id === confirmed.announcement_date!.source_id);
    if (source && gap >= 0 && gap <= 31) return { kind: "original", iso, quote: confirmed.announcement_date!.evidence_quote, source };
  }
  void articleSource;
  return { kind: "month", month: articleIso.slice(0, 7) };
}

export const isOriginalCandidate = (url: string, domain: string | null) => classifySourceType(url, domain ?? undefined) !== "aggregator_snippet";
