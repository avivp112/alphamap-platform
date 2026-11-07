/**
 * lib/enrichment/competitorTiers.ts — more competitors at the same standard of evidence, and a weaker tier shown
 * apart (owner, 2026-11-07; docs/competitors_proposal.md). Pure.
 *
 *   declared — a source says, directly, that they compete:
 *     · a sentence of a page already read: "<Company> competes with X, Y and Z", "X, a rival of <Company>" …
 *     · an "X vs Y" page on the company's own site, or on the competitor's own site (its title or heading, never a menu);
 *   market — the model proposed it (a hint, never shown as such) and an allowed source puts both companies in
 *     the same market, in one sentence with a market word, with its quote.
 *
 * Every claim carries a source id and a verbatim quote, and passes competitorEvidence.ts (primary source, not a
 * listing or a data platform, a direct link between the two) — a market claim passes marketEvidenceProblem.
 */
import { normalizeForMatch } from "./evidence";
import { isDataPlatformUrl } from "./dataPlatforms";
import { competitorEvidenceProblem, isLinkList, isListingPage, quoteLinksTheTwo } from "./competitorEvidence";
import { roundSourceStanding } from "./roundSources";
import { namesCompany } from "./headcount";
import type { LabeledSource } from "./sources";

export type CompetitorTier = "declared" | "market";
export interface TieredClaim { name: string; source_id: string; evidence_quote: string; tier: CompetitorTier; how_it_competes: string; website?: string }

const sentencesOf = (text: string) => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z“"'])/);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const coreName = (n: string) => normalizeForMatch(n.replace(/,?\s*\b(inc|incorporated|llc|ltd|limited|corp|corporation|gmbh|plc|co)\b\.?$/i, ""));

/** A name as press writes one: capitalised words, & . ' - and digits allowed ("New Relic", "Palo Alto Networks", "AT&T"). */
const NAME = "[A-Z0-9][\\w&.'’-]*(?:\\s+(?:of\\s+|the\\s+)?[A-Z0-9][\\w&.'’-]*){0,3}";
const STOP = new Set(["the", "a", "an", "and", "or", "in", "on", "for", "with", "also", "other", "which", "who", "that", "as", "at", "its", "their", "both", "all", "many", "most", "several", "some", "several", "big", "large", "established", "legacy"]);

/** "Datadog, New Relic, and Splunk" → ["Datadog", "New Relic", "Splunk"]. */
export function namesInList(list: string): string[] {
  const out: string[] = [];
  for (const part of list.split(/\s*(?:,|;|\band\b|\bor\b|&(?=\s))\s*/i)) {
    const m = part.trim().replace(/^(?:the likes of|such as|like|including|platforms such as|companies such as|rivals such as)\s+/i, "")
      .replace(/^(?:[\w]+-(?:backed|owned|based|funded|led|founded)\s+)+/i, "")   // "SoftBank-backed Blinkit" is Blinkit
      .match(new RegExp(`^(${NAME})`));
    if (!m) continue;
    const name = m[1].replace(/[.,;:]+$/, "").trim();
    if (!name || STOP.has(name.toLowerCase()) || name.length < 2) continue;
    out.push(name);
  }
  return [...new Set(out)];
}

/**
 * Competitors named in the sentences of the sources, where the company is the subject or a side of the comparison.
 * Candidates only: each is then judged by competitorEvidenceProblem.
 */
export function rivalSentenceClaims(sources: LabeledSource[], companyName: string): TieredClaim[] {
  const company = esc(companyName.trim());
  const patterns: Array<{ re: RegExp; take: (m: RegExpMatchArray) => string }> = [
    // "<Company> competes with the likes of X, Y and Z"
    { re: new RegExp(`\\b${company}\\b[^.]{0,60}?\\b(?:competes?|competing)\\s+with\\s+(?:the likes of\\s+|companies (?:such as|like)\\s+|platforms such as\\s+|rivals such as\\s+)?((?:(?!\\.\\s|\\.$)[^;]){2,160})`, "i"), take: (m) => m[1] },
    // "<Company> is a (European) rival to X" / "rival of X"
    { re: new RegExp(`\\b${company}\\b[^.]{0,40}?\\brivals?\\s+(?:to|of)\\s+(?:the\\s+)?(?:(?:U\\.S\\.|U\\.K\\.|[a-z][a-z.-]*)\\s+){0,3}?(?!U\\.[SK]\\.\\s)(${NAME})`), take: (m) => m[1] },
    // "<Company>'s competitors include X, Y" / "competitors such as"
    { re: new RegExp(`\\b${company}(?:['’]s)?\\b[^.]{0,40}?\\bcompetitors\\s+(?:include|such as|like)\\s+((?:(?!\\.\\s|\\.$)[^;]){2,160})`, "i"), take: (m) => m[1] },
    // "X, a rival of <Company>" / "X competes with <Company>"
    { re: new RegExp(`^(${NAME})\\b[^.]{0,120}?\\b(?:competes?|competing)\\s+with\\s+(?:[A-Za-z-]+\\s+){0,2}${company}\\b`), take: (m) => m[1] },
    { re: new RegExp(`(${NAME}),?\\s+an?\\s+(?:[a-z-]+\\s+){0,3}(?:rival|competitor)\\s+(?:to|of)\\s+${company}\\b`), take: (m) => m[1] },
  ];
  const out: TieredClaim[] = [];
  const key = new Set<string>();
  for (const src of sources) {
    for (const sen of sentencesOf(`${src.title ?? ""}. ${src.content}`)) {
      if (sen.length > 400 || !namesCompany(sen, companyName)) continue;
      for (const { re, take } of patterns) {
        const m = sen.match(re);
        if (!m) continue;
        for (const name of namesInList(take(m))) {
          if (coreName(name) === coreName(companyName)) continue;
          const k = `${src.source_id}|${coreName(name)}`;
          if (key.has(k)) continue;
          key.add(k);
          out.push({ name, source_id: src.source_id, evidence_quote: sen.trim().slice(0, 320), tier: "declared", how_it_competes: sen.trim().slice(0, 320) });
        }
      }
    }
  }
  return out;
}

/** The other name of an "A vs B" / "A versus B" title that has the company on one side, or null. */
export function vsTitleCompetitor(title: string, companyName: string): string | null {
  const t = title.trim();
  if (isLinkList(t)) return null;
  const parts = t.split(/\s+(?:vs\.?|versus)\s+/i);
  if (parts.length < 2 || parts.length > 3) return null;
  const clean = (s: string) => s.replace(/^(?:compare|comparison|comparing|alternatives?:?)\s+/i, "").replace(/\s*(?:[:|–—-].*)$/, "").replace(/\s+(?:compared|comparison|alternative|review|pricing|features?)\b.*$/i, "").trim();
  const names = parts.map(clean).filter(Boolean);
  const at = names.findIndex((n) => coreName(n) === coreName(companyName) || coreName(n).startsWith(coreName(companyName)));
  if (at < 0) return null;
  const other = names[at === 0 ? 1 : at - 1];
  return other && coreName(other) !== coreName(companyName) && other.length <= 40 ? other : null;
}

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const registrable = (host: string) => host.split(".").slice(-2)[0] ?? "";

/**
 * "X vs Y" pages from search results: on the company's own site (domain given) the title names both; on the
 * competitor's own site, the domain is the competitor's name and the title names the company.
 */
export function vsPageClaims(results: Array<{ url: string; title?: string | null; content?: string | null }>, sources: LabeledSource[], companyName: string, ownDomain: string | null): TieredClaim[] {
  const out: TieredClaim[] = [];
  for (const r of results) {
    const title = (r.title ?? "").trim();
    const other = title ? vsTitleCompetitor(title, companyName) : null;
    if (!other) continue;
    const host = hostOf(r.url);
    const own = !!ownDomain && (host === ownDomain || host.endsWith(`.${ownDomain}`));
    const theirs = !own && coreName(registrable(host)) === coreName(other).replace(/\s+/g, "");
    if (!own && !theirs) continue;
    const src = sources.find((s) => s.url === r.url);
    if (!src) continue;
    out.push({ name: other, source_id: src.source_id, evidence_quote: title, tier: "declared", how_it_competes: `${own ? companyName : other} publishes a comparison page: "${title}".` });
  }
  return out;
}

const MARKET_WORD = /\b(market|space|industry|sector|category|segment|landscape|players?|vendors?|providers?|platforms?|companies such as|competes?|rivals?|alongside|including|such as|among)\b/i;

/** Why a market claim does not stand, or null: an allowed source, one sentence with both companies and a market word. */
export function marketEvidenceProblem(c: { name: string; source_id: string; evidence_quote: string }, sources: LabeledSource[], companyName: string): string | null {
  const src = sources.find((s) => s.source_id === c.source_id);
  if (!src) return "market_no_source";
  if (isDataPlatformUrl(src.url) || src.source_type === "aggregator_snippet") return "market_from_data_platform";
  if (isListingPage(src)) return "market_from_listing";
  const standing = roundSourceStanding(src.url, { isCompanySite: src.source_type === "company_site" });
  if (standing.kind !== "allowed" || standing.tier > 3) return "market_source_not_allowed";
  if (!normalizeForMatch(`${src.title ?? ""} ${src.content}`).includes(normalizeForMatch(c.evidence_quote))) return "market_quote_not_in_source";
  const q = ` ${normalizeForMatch(c.evidence_quote)} `;
  if (!q.includes(` ${coreName(companyName)} `) || !q.includes(` ${coreName(c.name)} `)) return "market_quote_not_both";
  if (!MARKET_WORD.test(c.evidence_quote)) return "market_no_market_word";
  if (isLinkList(c.evidence_quote)) return "market_link_list";
  return null;
}

/** Hints the model proposed, each looked for in one sentence of an allowed source that names both with a market word. */
export function marketPeerClaims(hints: string[], sources: LabeledSource[], companyName: string): TieredClaim[] {
  const out: TieredClaim[] = [];
  const seen = new Set<string>();
  for (const hint of hints) {
    const hk = coreName(hint);
    if (!hk || hk === coreName(companyName) || seen.has(hk)) continue;
    for (const src of sources) {
      let found: string | null = null;
      for (const sen of sentencesOf(`${src.title ?? ""}. ${src.content}`)) {
        if (sen.length > 400 || !namesCompany(sen, companyName) || !namesCompany(sen, hint) || !MARKET_WORD.test(sen)) continue;
        const claim = { name: hint, source_id: src.source_id, evidence_quote: sen.trim().slice(0, 320) };
        if (!marketEvidenceProblem(claim, sources, companyName)) { found = claim.evidence_quote; break; }
      }
      if (found) { seen.add(hk); out.push({ name: hint, source_id: src.source_id, evidence_quote: found, tier: "market", how_it_competes: found }); break; }
    }
  }
  return out;
}

/** Declared claims that pass the evidence rules (a primary source, a direct link), as the extraction's own do. */
export function acceptedDeclared(claims: TieredClaim[], sources: LabeledSource[], companyName: string): TieredClaim[] {
  return claims.filter((c) => !competitorEvidenceProblem(c, sources, companyName) && quoteLinksTheTwo(c.evidence_quote, companyName, c.name));
}
