/**
 * lib/enrichment/rowRules.ts — the same rules for every value of a report, whether this run found it or the memory of verified sources carried it (owner, round 10:
 * after a round of fixes the report was "exactly as before" — carried rows and injected values had never passed the new gates). Used on the memory when it is loaded
 * and on the final rows of every company.
 */
import { isListingOrSponsoredUrl } from "./pageKind.ts";
import { isExplainer, namesCompanyUpFront } from "./newsRelevance.ts";
import { foundedYearFromSite } from "./siteFacts.ts";
import { NOT_A_PRODUCT_SENTENCE } from "./quoteFinder.ts";
import { acquirerIn, claimFromEvents, detectAcquisition, knownAcquirers } from "./acquisition.ts";
import { detectClosure } from "./closure.ts";
import { normalizeForMatch, quoteIsNotASentence } from "./evidence.ts";
import { sectorDecision } from "./techOverrides.ts";
import { foundingSentenceIsAboutCompany, isThirdPartyPage, sentenceIsAboutCompany } from "./subject.ts";
import { isLegalPageUrl } from "./headquarters.ts";
import { isAddressLine, articleDate } from "./headquarters.ts";
import { vsTitleCompetitor, comparisonTitleCompetitor } from "./competitorTiers.ts";
import { amountFromAddress } from "./hints.ts";
import { extractNumbersFromText } from "./evidence.ts";
import { statedRoundLabels } from "./assemble.ts";
import { refineRoundType } from "./rounds.ts";

import { cleanPersonName } from "./people.ts";
import { currencyOfAmount } from "./currency.ts";
export interface RowLike { company?: string; field: string; after: string; source_url?: string | null; quote?: string | null; payload?: string | null; before?: string | null; [k: string]: unknown }

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const PERSON_PAGE = /\/(?:leadership|team|people|management|board|bio|biography|about\/team)\/[^/?#]+/i;

const PAID_DISTRIBUTION = /(?:^|\/\/|\.)(?:marketersmedia\.com|yespress\.com|openpr\.com|send2press\.com|prlog\.org|newswire\.net|pr\.com)(?:\/|$)/i;
const SPONSORED_PATH = /\/(?:patrocinado|patrocinados|sponsored|sponsor|brand-?studio|advertorial|partner-?content|paid-?post|content-?hub|branded)(?:\/|-|$)/i;
const PRODUCT_REVIEW = /\breviews?\b|\bhonest (?:verdict|review|opinion)\b|\bour verdict\b|\bworth it\b|\bunboxing\b|\bbest (?:\w+ ){0,3}(?:of|in|for) 20\d{2}\b|\btop \d+\b/i;
const CAREERS_OR_LEGAL = /\/(?:careers?|carreiras?|jobs?|vagas?|empleos?|karriere|emplois?|recrutement|trabalhe-conosco|terms|termos|terminos|privacy|privacidade|legal|impressum|cookies?)(?:[\/-]|$)/i;
const JOB_AD_STRONG = /\b(?:we are hiring|apply now|years of experience|salary|bachelor['’]s degree|ensino superior|experi[eê]ncia comprovada)\b/i;
const JOB_AD_WEAK = /\b(?:experience (?:required|with|in)|responsibilities|requirements|qualifications|you will)\b/gi;
/** A job advertisement: one clear marker, or two of the weak ones — a product sentence that says "you will" or "experience with" is not one (owner, batch 8: Berg System's CRM). */
const isJobAd = (q: string) => JOB_AD_STRONG.test(q) || new Set((q.match(JOB_AD_WEAK) ?? []).map((x) => x.toLowerCase())).size >= 2;
const brandOf = (companyName: string) => fold(companyName.replace(/\b(ai|inc|ltd|llc|labs?|group|studio|studios|technologies|software|systems)\b/gi, ""));
let ambiguous: Set<string> | null = null;
const ambiguousDeny = (name: string): RegExp | null => { try { const j = JSON.parse(readFileSync("eval/ambiguous_names.json", "utf8")) as { deny?: Record<string, string> }; const k = Object.keys(j.deny ?? {}).find((x) => fold(x) === fold(name)); return k ? new RegExp(j.deny![k], "i") : null; } catch { return null; } };
export const ambiguousName = (name: string): boolean => {
  if (!ambiguous) { ambiguous = new Set(); try { for (const n of (JSON.parse(readFileSync("eval/ambiguous_names.json", "utf8")) as { names?: string[] }).names ?? []) ambiguous.add(fold(n)); } catch { /* none */ } }
  return ambiguous.has(fold(name));
};
/** The source address is on the company's own domain (its name in the host). */
export function ownDomain(url: string | null | undefined, companyName: string): boolean {
  try { const h = new URL((url ?? "").startsWith("http") ? url! : `https://${url}`).hostname.toLowerCase(); const b = brandOf(companyName); return (b.length >= 3 && fold(h).includes(b)) || extraDomainsOf(companyName).some((d) => h === d || h.endsWith(`.${d}`)); } catch { return false; }
}
/** A competitor's name without a year or a bracket ("Dhan (2026)" → "Dhan"). */
import { caseName } from "./nameCase.ts";
import { roundSourceStanding } from "./roundSources.ts";
import { readFileSync } from "fs";
import { extraDomainsOf } from "./ownDomain.ts";
export const cleanCompetitorName = (n: string): string => caseName(n).replace(/\s*\([^)]*\)/g, "").replace(/\s+(?:19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
/** A product or a model, no company ("an open-weight alternative to GPT-4o Realtime": GPT is OpenAI's model; owner, batch 7: UltraVox). */
const PRODUCT_NOT_COMPANY = /^(?:chat\s?gpt|gpt(?:[- ]?\d[\w.]*)?|gemini(?: pro| ultra| nano)?|llama(?: ?\d[\w.]*)?|claude(?: ?\d[\w.]*)?|copilot|bard|dall[- ]?e(?: ?\d)?|whisper|codex|stable diffusion|sora|alexa|siri)$/i;
const COMPETITOR_STOP = /^(?:the\s+)?(?:real[- ]estate|stocks?|shares?|equity|mutual funds?|bonds?|gold|silver|fixed deposits?|crypto(?:currency)?|etfs?|ipos?|forex|futures|options|insurance|loans?|savings|banks?|competitors?|competitor|concorrentes?|competidores?|competencia|concurrents?|konkurrenten?|concorrenti|konkurenci|alternatives?|tools?|software|platforms?)$/i;

/** A quote that is an address or a slug, not text of the page (owner, round 10: Paradox Series C's quote was the URL). */
export const looksLikeAddress = (q: string): boolean => { const t = q.trim(); return !!t && (/^https?:\/\//i.test(t) || (!/\s/.test(t) && /[a-z0-9]+(?:-[a-z0-9]+){3,}/i.test(t))); };

/** The brand as the page writes it ("Tyro Health", not the domain's "tyrohealth"): a run of capitalised words in the company's own texts that folds to the same letters; a trailing 2-letter country tag is dropped. */
export function brandAsWritten(value: string, texts: string[]): string {
  const f = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  const candidates = [value, value.replace(/\s+[A-Z]{2}$/, "")];
  for (const cand of candidates) {
    const want = f(cand);
    if (!want) continue;
    for (const t of texts) for (const m of t.matchAll(/\p{Lu}[\p{L}\p{N}&'’-]*(?:\s+\p{Lu}[\p{L}\p{N}&'’-]*){0,3}/gu)) {
      const words = m[0].split(/\s+/);
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j <= words.length; j++) { const ph = words.slice(i, j).join(" "); if (f(ph) === want) return ph; }
    }
  }
  return value;
}

/**
 * The name a company trades under after a purchase, as its own pages write it: "Tyro Health, formerly Medipass", "Tyro Health, which operates under the Medipass name",
 * "Humi by Employment Hero", "Humi, now part of Employment Hero". Null when no text says it.
 */
export function brandFromTexts(companyName: string, texts: string[]): string | null {
  const name = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const CAP = "(\\p{Lu}[\\p{L}\\p{N}&'’-]*(?:\\s+\\p{Lu}[\\p{L}\\p{N}&'’-]*){0,3})";
  const res = [
    new RegExp(`${CAP},?\\s+(?:formerly|previously|fka|f/k/a|formerly known as|which operates under the|which trades as|operating as)\\s+(?:the\\s+)?${name}\\b`, "u"),
    new RegExp(`\\b${name}\\b,?\\s+(?:now part of|now a part of|is now part of|is part of|is now|now)\\s+${CAP}`, "iu"),
    new RegExp(`\\b${name}\\s+by\\s+${CAP}`, "u"),
  ];
  for (const t of texts) for (const re of res) {
    const m = t.match(re);
    const b = m?.[1]?.trim();
    if (b && b.toLowerCase() !== companyName.trim().toLowerCase()) return b;
  }
  return null;
}

/** Date part of a round's text ("Series A $4M · 2017-09-05 …"): 3 day, 2 month, 1 year, 0 none. */
export function datePrecision(after: string): number {
  const d = after.match(/(\d{4}(?:-\d{2}(?:-\d{2})?)?)/)?.[1] ?? "";
  return d.length === 10 ? 3 : d.length === 7 ? 2 : d.length === 4 ? 1 : 0;
}
/** Company + type + amount: the identity of a round, whatever its date or lead. */
export function roundKey(r: { company?: string | null; after: string }): string {
  const t = r.after.replace(/\s*·\s*lead\s+.*$/i, "").replace(/\(month only\)/i, "");
  const type = t.match(/^\s*([A-Za-z][A-Za-z+\- ]*?)(?=\s+(?:\$|€|£|USD|amount)|\s*·|\s*$)/)?.[1] ?? "";
  const amount = t.match(/([$€£]\s?[\d.,]+\s?[KMBkmb]?|amount not disclosed)/i)?.[1] ?? "";
  return `${fold(r.company ?? "")}|${fold(type)}|${fold(amount)}`;
}


// ── Quality rules of the maintenance window (owner, 2026-11-23) ─────────────────────────────────────────────────────────────────────────────────────
const escRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SCALE_OF: Record<string, number> = { thousand: 1e3, k: 1e3, million: 1e6, mn: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9 };
const MONEY = "(?:[$€£¥₩]|US\\$|[A-Z]{3}\\s)?\\s?(\\d[\\d,]*\\.?\\d*)\\s?(thousand|million|billion|mn|bn|[kKmMbB])?\\b(?:\\s?(?:USD|EUR|GBP|RMB|CNY|KRW|yuan|won))?";
const moneyValue = (num: string, scale?: string) => parseFloat(num.replace(/,/g, "")) * (scale ? SCALE_OF[scale.toLowerCase()] ?? 1 : 1);
/** The figures a quote ties to a grant, a contract or an award ("bags $2.5M grant", "a $318M contract", "awarded $2M"). */
export function grantLikeAmounts(quote: string): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(new RegExp(`${MONEY}\\s+(?:[\\w-]+\\s+){0,2}(?:grants?|contracts?|awards?)\\b`, "gi"))) out.push(moneyValue(m[1], m[2]));
  for (const m of quote.matchAll(new RegExp(`\\b(?:grants?|contracts?|awards?|awarded)\\s+(?:of |worth |valued at |totall?ing |up to )?${MONEY}`, "gi"))) out.push(moneyValue(m[1], m[2]));
  return out.filter((x) => x > 0);
}
/** The amount(s) of a round line: the dollar figure, and the source's own when the line carries "(CNY 600,000,000)". */
function roundAmounts(after: string): { usd: number | null; original: { currency: string; amount: number } | null } {
  const u = /\$([\d.,]+)\s?([KMB])?\b/.exec(after);
  const o = /\(([A-Z]{3}) ([\d,]+)\)/.exec(after);
  return { usd: u ? moneyValue(u[1], u[2]) : null, original: o ? { currency: o[1], amount: parseFloat(o[2].replace(/,/g, "")) } : null };
}
/** A round whose quote writes the amount in a currency other than the line's: "RMB 600 million" read as dollars (owner, 2026-11-23: Shengshu, Mobilint's KRW). */
export function roundCurrencyProblem(after: string, quote: string | null | undefined): string | null {
  if (!quote) return null;
  const { usd, original } = roundAmounts(after);
  if (original) { const c = currencyOfAmount(original.amount, quote); return c && c !== original.currency ? `the quote writes the amount in ${c}, the line says ${original.currency}` : null; }
  if (usd) { const c = currencyOfAmount(usd, quote); return c && c !== "USD" ? `the quote writes the amount in ${c}, the line says dollars` : null; }
  return null;
}
/** A person who is a founder of ANOTHER company in the quote ("X, co-founder of Oscilla"; "Oscilla was founded by X"), or null. */
export function founderOfOtherCompany(name: string, quote: string, companyName: string): string | null {
  const esc = name.trim().split(/\s+/).map(escRe).join("\\s+");
  const NAME = "([A-Z][\\w&.'’-]*(?:\\s+[A-Z&][\\w&.'’-]*){0,3})";
  const own = fold(companyName).replace(/(inc|ltd|llc|corp|gmbh|ag|bv|the)$/g, "");
  const generic = /^(it|we|they|he|she|this|that|the|company|founders?|co-?founders?|our|his|her|their|who|and|which)$/i;
  const other = (org: string) => { const f = fold(org); return f.length >= 3 && !generic.test(org.trim()) && !f.includes(own) && !(own.length >= 3 && own.includes(f)); };
  const a = new RegExp(`${esc}[^.\\n]{0,80}?\\b(?:co-?)?founders?\\s+(?:of|at)\\s+(?:the\\s+)?${NAME}`).exec(quote);
  if (a && other(a[1])) return a[1];
  const b = new RegExp(`${NAME}\\s+(?:was\\s+|were\\s+|is\\s+)?(?:co-?)?founded\\s+by[^.\\n]{0,100}?${esc}`).exec(quote);
  if (b && other(b[1])) return b[1];
  return null;
}
const ROLE_FORMS: Array<[string, RegExp, RegExp]> = [
  ["CEO", /\bceo\b/i, /chief executive|\bceo\b/i], ["CTO", /\bcto\b/i, /chief (?:technology|technical|tech)|\bcto\b/i], ["COO", /\bcoo\b/i, /chief operating|operations officer|\bcoo\b/i],
  ["CFO", /\bcfo\b/i, /chief financial|\bcfo\b/i], ["CMO", /\bcmo\b/i, /chief marketing|\bcmo\b/i], ["CPO", /\bcpo\b/i, /chief (?:product|people|privacy)|\bcpo\b/i],
  ["CRO", /\bcro\b/i, /chief revenue|\bcro\b/i], ["CIO", /\bcio\b/i, /chief information|\bcio\b/i], ["President", /\bpresident\b/i, /\bpresident\b/i],
  ["Chairman", /\bchair(?:man|woman|person)?\b/i, /\bchair/i], ["Managing Director", /\bmanaging director\b/i, /managing director/i],
];
/** A title keeps only the roles its quote gives (owner, 2026-11-23: Deliverect's CTO and CPO, written as CPO and President): the others are taken out; "Co-Founder" is never touched here. */
export function titleMatchingQuote(title: string, quote: string): string {
  const parts = title.split(/\s*(?:&|,|\/|\band\b|\|)\s*/i).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => { const f = ROLE_FORMS.find(([, t]) => t.test(p)); return !f || f[2].test(quote); });
  return kept.length === parts.length ? title : kept.join(" & ");
}

/** Why this value may not stand under today's rules, or null. */
export function rowProblem(r: RowLike, companyName: string, today: string, weekBefore = 0, o: { domain?: string | null; acquirers?: string[] } = {}): string | null {
  const url = r.source_url ?? "";
  if (r.quote && looksLikeAddress(r.quote)) return "its quote is an address, not text of the page";
  if (r.quote && quoteIsNotASentence(r.quote)) return "its quote is page code, not a sentence";
  if ((r.field === "founder" || r.field === "leader") && r.after) {
    const nm = r.after.split(" — ")[0];
    if (nm !== cleanPersonName(nm)) return "the name carries a function word or a role fragment (\"As Karim Nour\", \"Karim Nour Co\")";
  }
  if ((r.field === "founder" || r.field === "leader") && r.after && r.quote) {
    const [nm, ...rest] = r.after.split(" — "); const role = rest.join(" — ");
    const q = r.quote;
    // A role at another company (owner, batch 8: Screaming Frog's Will Hodson is "Co-Founder – The Big Deal"): the quote gives the person's role beside another organisation, not this one.
    const ROLE = "co-?founders?|founders?|ceo|cto|coo|cfo|cmo|cpo|president|chair\\w*|director|partner|head of [a-z ]{2,20}|managing director";
    const near = new RegExp(`${nm.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}[^.\\n]{0,60}?\\b(?:${ROLE})\\s*(?:[–—-]|@|\\bat\\b)\\s*([A-Z][\\w&.'’]*(?:\\s+[A-Z&][\\w&.'’]*){0,4})`, "i").exec(q);
    if (near) {
      const org = fold(near[1]);
      const own = fold(companyName).replace(/(inc|ltd|llc|corp|gmbh|ag|bv|the)$/g, "");
      if (org.length >= 3 && !/^(?:ceo|cto|coo|cfo|cmo|cpo|chief\w*|co-?founder|founder|president|chair\w*|director|partner|head|vice|vp|svp|evp|managing|general|executive)/i.test(near[1].trim()) && !(org.includes(own) || (own.length >= 3 && own.includes(org)))) return `a role at another company (${near[1].trim()}), not here`;
    }
  }
  // A founder is declared only when the quote attributes the founding to THIS company (owner, 2026-11-23: Usersnap's founders of another blog, CorPower's co-founder of Oscilla from an Oscilla filing, Bloom Security's name not in its quote).
  if (r.field === "founder" && r.after && r.quote) {
    const nm = r.after.split(" — ")[0].trim(), q = r.quote;
    const surname = fold(nm.split(/\s+/).pop() ?? "");
    if (surname.length >= 2 && !fold(q).includes(surname)) return "the quote does not name the person";
    if (!/found|establish|started|set up|created/i.test(q)) return "the quote does not say the person founded the company";
    const org = founderOfOtherCompany(nm, q, companyName);
    if (org) return `the quote attributes the founding to another company (${org})`;
  }
  // A name that several companies carry (owner, batch 8: Shyft — a Miami moving app, a Standard Bank FX app, The Shyft Group): a value stands only on the company's own domain on file (owner, 2026-11-20: Shyft only from getshyft.co.za). eval/ambiguous_names.json: { "names": ["Shyft"] }.
  { const deny = ambiguousDeny(companyName); if (deny && deny.test(`${r.after} ${r.quote ?? ""}`)) return `${companyName}: the value speaks of another company that carries the name (${(`${r.after} ${r.quote ?? ""}`.match(deny) ?? [""])[0]})`; }
  if (o.domain && url && r.field !== "(nothing)" && ambiguousName(companyName)) {
    const host = (u: string) => { try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
    const mine = host(o.domain), h = host(url);
    const onMine = !!mine && (h === mine || h.endsWith(`.${mine}`));
    // News and the purchase read from it are external sources by nature, and the entity check already compared each of them with the company's own pages (collect.ts articleIsThisCompany; identityMismatch.ts): they may stand on
    // another site. Every other field stays "only from the site on file" (owner, 2026-11-24: Aperio — the purchase by Leica stands, the $4.5M round of Aperio Systems does not).
    if (!onMine && !["news", "acquired"].includes(r.field)) return `${companyName} is a name several companies carry: a value stands only on the site on file (${mine})`;
  }
  const bad = isListingOrSponsoredUrl(url);
  if (bad) return bad === "sponsored_content" ? "its source is sponsored content" : "its source is a tag, list or search page, not the article";
  const quote = r.quote ?? "";
  // A source no field may rest on (owner, batch 7): paid distribution services, sponsored / brand-studio paths, a republisher with no allowed original, a data platform.
  if (["news", "tags", "round", "competitor_declared", "competitor_market", "founder"].includes(r.field) && url) {
    if (PAID_DISTRIBUTION.test(url)) return "a paid press-distribution service, not a newsroom";
    if (SPONSORED_PATH.test(url)) return "sponsored or brand-studio content";
  }
  if (r.field === "news") {
    const m = r.after.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/);
    const date = m?.[1] ?? null, title = (m?.[2] ?? r.after).trim();
    if (date && date >= today) return `its date (${date}) is the day of the run`;
    // The memory holds no page text to find a date in: a date in the week before the run is not kept from it (the run reads the page itself).
    if (date && weekBefore > 0 && date >= new Date(Date.parse(today) - weekBefore * 86_400_000).toISOString().slice(0, 10)) return `its date (${date}) is in the week before the run`;
    if (isExplainer(title)) return "a guide or explainer, not news";
    if (PRODUCT_REVIEW.test(title)) return "a product review or a ranking, not news about the company";
    if (!namesCompanyUpFront({ title, content: "" }, companyName)) return "its headline does not name the company";
  }
  if (r.field === "founded_year") {
    if (/!\[|\]\(/.test(quote)) return "its quote is an image or a link";
    if (/\bsince\b/i.test(quote) && !foundedYearFromSite(quote)) return "\"since <year>\" here is not a founding statement";
    if (quote && !foundingSentenceIsAboutCompany(quote, r.after.trim(), companyName, { ownSite: ownDomain(url, companyName), url })) return "its sentence is not about the company";
    if (isThirdPartyPage(url)) return "a customer, project or partner page does not say when the company was founded";
  }
  if (r.field === "tags") {
    if (!url) return "no source";
    // "assurance vie" is a French investment wrapper, not insurance (owner, batch 7: Yomoni, an automated investment service).
    if (/insur|assuranc|seguro/i.test(r.after) && /assurances?[- ]vie/i.test(quote) && !/insur|assuranc|seguro/i.test(quote.replace(/assurances?[- ]vie/gi, ""))) return "\"assurance vie\" is an investment wrapper, not insurance";
    // A guide or a blog post of the company's own site is content marketing, no description of what it sells (owner, batch 7: Uxcel's tag from a guide on OKRs).
    // — unless the sentence is about the company itself ("Mintifi offers supply chain financing…", "We provide…"): it is the topic of the page that does not describe the product, not the folder it is in.
    if (ownDomain(url, companyName) && /\/(?:blog|guides?|articles?|tutorials?|how-to|resources?)(?:\/|$)/i.test((() => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname; } catch { return ""; } })()) && !sentenceIsAboutCompany(quote, companyName, { ownSite: true })) return "a blog post or a guide on another topic is no description of the product";
    if (NOT_A_PRODUCT_SENTENCE.test(quote)) return "its quote is not a product sentence";
    // The words of a tag are a sentence about the product (owner, batch 7): not a careers or legal page, a job advertisement, a menu, or a person's speech.
    try { if (CAREERS_OR_LEGAL.test(new URL(url.startsWith("http") ? url : `https://${url}`).pathname)) return "a careers or legal page is no evidence for a tag"; } catch { /* no address */ }
    if (isJobAd(quote)) return "its quote is a job advertisement";
    if ((quote.match(/[·|•]/g) ?? []).length >= 3) return "its quote is a menu, not a sentence";
    if (/\b(?:said|says|told)\b,?\s*['"“‘’]{1,2}/i.test(quote)) return "its quote is a person's speech, not a sentence about the product";
    if (PERSON_PAGE.test(url)) return "a person's page does not support a tag";
    // A source that is not the company's own must be about the company: the brand is in its quote or its address.
    const brand = fold(companyName.replace(/\b(ai|inc|ltd|llc|labs?|group)\b/gi, ""));
    if (brand.length >= 3 && !fold(quote).includes(brand) && !fold(url).includes(brand)) return "its quote and address do not name the company";
    // A filing or a list of another company's document is no description of this one (owner, 2026-11-19: Orizuru's tag from a list in another company's 10-K).
    if (!ownDomain(url, companyName) && /(?:^|\/\/)(?:www\.)?sec\.gov\b|\/(?:10-?k|10-?q|20-?f|8-?k|annual-report)\b/i.test(url)) return "a filing of another company is no source for a tag";
  }
  // A registered address is registered_address and nothing else (owner, batch 8: Smarter Contracts, lawhive): no headquarters, no office.
  if ((r.field === "hq_city" || r.field === "hq_country" || r.field === "office") && /\bregistered\s+(?:office|address|seat)\b|\bregistered\s+in\b|\bsede\s+(?:legal|social)\b|\bsiège\s+social\b|\beingetragene[rn]?\s+sitz\b|\bsiedziba\s+(?:prawna|rejestrowa)\b/i.test(quote)) return "a registered address is no headquarters or office: it belongs to registered_address only";
  if (r.field === "hq_city" || r.field === "hq_country") {
    // The same tests for a new value and a remembered one (owner, batch 6): a headquarters rests on a street address or on a sentence that declares it, and on a site that is not the company's own it is not older than eight years.
    const DECL = /headquarter|\bhq\b|head ?office|\bbased\b|-based|\bsede\b|\bsitz\b|siège|matriz|siedzib|مقر|本社|본사|штаб/i;
    if (quote && !isAddressLine(quote) && !DECL.test(quote)) return "its quote is neither a street address nor a headquarters statement";
    // A press statement needs a date; the latest wins (owner, batch 6). An address that carries only a year ("/2014/sticker-beacon…") gives none.
    if (url && !ownDomain(url, companyName) && !articleDate({ url, content: quote }) && /\/(?:19|20)\d{2}\/[^/]/.test(url)) return "the article's date is only a year";
  }
  if (r.field === "office" && !quote.trim()) return "an office needs a quote";
  // "150+" is a lower bound without a ceiling: it may be over 200, so no range is derived from it (owner, batch 8) — except the open top range.
  if (r.field === "round" && !/^[^:{]*\sfilled:/.test(r.after)) {
    // A round rests on a quote that speaks of funding (owner, 2026-11-19: Orizuru's "round" had no quote and its page announced a launch).
    if (!quote.trim()) return "a round needs a quote";
    if (!/rais|fund|invest|financ|series|seed|round|capital|led by|backed|valuation|loan|debt|grant|\$|€|£|million|\d\s?[mk]\b/i.test(quote)) return "its quote does not speak of funding";
    // A grant, a contract and an award are not a funding round; a plan to raise is not a round that closed (owner, 2026-11-23: MinerEye's $2.5M grant, Dataminr's $318M contract).
    { const { usd, original } = roundAmounts(r.after); const mine = [usd, original?.amount].filter((x): x is number => x != null && x > 0);
      if (mine.length && grantLikeAmounts(quote).some((g) => mine.some((a2) => Math.abs(g - a2) / a2 < 0.005))) return "a grant, a contract or an award is not a funding round"; }
    if (/\b(?:plans?|planning|aims?|aiming|seeks?|seeking|looking|intends?|intending|hopes?|hoping|expects?|wants?)\s+(?:\w+\s+){0,2}?to\s+raise\b/i.test(quote) && !/\b(?:raised|has raised|closed|secured|completed|closes|completes)\b/i.test(quote)) return "a plan to raise is not a round that closed";
    const cur = roundCurrencyProblem(r.after, quote); if (cur) return cur;
  }
  // A proposed name is a clean brand name, not a piece of a sentence (owner, 2026-11-19: Lulalend's "Lula. We").
  if (r.field === "name_proposal") {
    const nm = r.after.match(/name\s*=\s*"([^"]*)"/)?.[1] ?? "";
    if (nm && (/[.!?]\s+\S/.test(nm) || (/[.!?]$/.test(nm) && !/\b(?:inc|ltd|llc|co|corp|plc|gmbh|s\.a|b\.v)\.$/i.test(nm)) || nm.split(/\s+/).length > 5)) return "a proposed name is a clean brand name, not a fragment of a sentence";
  }
  // A description in a sentence that names two employers belongs to the one it stands beside (owner, 2026-11-19: Weezy's "McKinsey, consumer goods" from "consumer goods at P&G … McKinsey").
  if (r.field === "founder_background") {
    const m = r.after.match(/—\s*([^,]+?),\s*(.+)$/);
    if (m && quote) {
      const employer = fold(m[1]), desc = m[2].trim().toLowerCase();
      const at = new RegExp(`${desc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:at|for|with|in)\\s+([A-Z][\\w&.]*(?:\\s+[A-Z&][\\w&.]*){0,3})`, "i").exec(quote);
      if (at && employer && !fold(at[1]).includes(employer) && !employer.includes(fold(at[1]))) return `the description "${m[2].trim()}" in the quote belongs to ${at[1].trim()}, not to ${m[1].trim()}`;
    }
  }
  if (r.field === "employee_range" && !/^10001\+$/.test(r.after.trim()) && /\b\d[\d,]*\s*\+\s*(?:employees|staff|people|team members|colleagues|mitarbeiter|empleados|funcion[aá]rios|collaborateurs)?/i.test(quote) && /\b\d[\d,]*\s*\+/.test(quote)) return "a count with a plus (\"150+\") has no ceiling: no range is derived from it";
  if (r.field === "employee_range" && /\bpeople with a name and a role are shown\b|\bpeople? (?:are )?shown on the page\b/i.test(quote)) return "a count of people shown on a page is a lower bound: no range";
  // The size of a company is not in its privacy policy or terms (owner, batch 7: Mama Money's "2" from a legal text), and the people a team page shows are a lower bound, no count: it stays in the history.
  if (r.field === "employee_range" || r.field === "employee_count") {
    if (url && isLegalPageUrl(url)) return "a legal page (privacy, terms) says nothing of the company's size";
    const teamPage = /\/(?:team|our-team|the-team|people|leadership|management|board|about\/team|meet-the-team|founders)(?:\/|$|-)/i.test(url);
    const statesStaff = /\b(?:employ|staff|headcount|colleague|workforce|team members|people (?:work|at)|fte|mitarbeiter|empleados|funcionários|collaborateurs)/i.test(quote);
    if (r.field === "employee_count" && /^\s*\d[\d,]*\s*\+\s*$/.test(r.after) && (teamPage || !statesStaff)) return "a count of the people a team page shows is a lower bound: kept in the history only";
  }
  // A profile page of a data platform (inc42.com/company/…, a "company" or "startup" profile) is no source for a round (owner, batch 8: Lendbox).
  if (r.field === "round" && url && !ownDomain(url, companyName) && /\/(?:company|companies|startups?|organi[sz]ations?|profiles?)\/[^/]+\/?(?:[?#].*)?$/i.test((() => { try { return new URL(url.startsWith("http") ? url : `https://${url}`).pathname; } catch { return ""; } })())) return "a data platform's profile page is no source for a round";
  // A story or history page states the size of the day it was written, not the run day (owner, batch 8): a point of the history carrying a date of the last week from such a page is out.
  if (r.field === "headcount_history" && /\/(?:our-story|story|history|about\/history|about-us\/history|timeline|milestones|who-we-are)(?:\/|$|\.)/i.test(url)) {
    const pt = r.after.match(/\bon (\d{4}-\d{2}-\d{2})\b/)?.[1];
    if (pt && pt >= new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10)) return "a story or history page does not date its figure with the run day";
  }
  if (r.field === "employee_range" || r.field === "employee_count" || r.field === "headcount_history") {
    // A dated page of the company's own site (a press release, a post) states the size of ITS day, not of today (owner, batch 6: Brighte's 2021 year in review gave "84" for the run day).
    // The page's date must be in its address or its quote; a point dated the run day from such a page is the old figure under a new date.
    const datedPath = /\/(news|newsroom|blog|press|press-releases?|media|insights|stories|updates)(\/|-|$)/i.test(url);
    if (datedPath && ownDomain(url, companyName)) {
      const pageDate = articleDate({ url, content: quote });
      const pointDate = r.field === "headcount_history" ? r.after.match(/\bon (\d{4}-\d{2}-\d{2})\b/)?.[1] : null;
      if (r.field !== "headcount_history" && !pageDate) return "a dated page of the site with no date is not today's headcount";
      if (r.field === "headcount_history" && pointDate && pointDate >= new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10) && (!pageDate || pageDate < pointDate)) return "a dated page's figure carries the run day as its date";
    }
  }
  if (r.field === "competitor_market" && PRODUCT_NOT_COMPANY.test(cleanCompetitorName(r.after))) return "its name is a product or a model, not a company";
  if (r.field === "competitor_declared") {
    const name = cleanCompetitorName(r.after);
    if (COMPETITOR_STOP.test(name)) return "its name is an investment type or a category, not a company";
    if (PRODUCT_NOT_COMPANY.test(name)) return "its name is a product or a model, not a company";
    // A rival named in a sentence about another company (WebBank's "Klarna competes with Affirm") is no competitor of this one: off the company's own site, the sentence must name the company.
    { const brand = fold(companyName.replace(/\b(ai|inc|ltd|llc|labs?|group|bank|the)\b/gi, "")); if (!ownDomain(url, companyName) && brand.length >= 3 && quote && !fold(quote).includes(brand) && !vsTitleCompetitor(quote, companyName)) return "its sentence does not name the company: a rival of another company"; }
    // A comparison page counts only on the company's own domain, with its title naming the other side (xe.com's "mBank vs Xe", an IPO page, "Real Estate").
    if (/\bIPOs?\b/i.test(quote) || /\/(?:[\w-]*-)?ipos?(?:[-/]|$)/i.test(url)) return "an IPO page, not a comparison with a competitor";
    if (/\b(?:vs\.?|versus)\b/i.test(quote)) {
      if (!ownDomain(url, companyName)) return "a comparison page of another site";
      const side = vsTitleCompetitor(quote, companyName) ?? comparisonTitleCompetitor(quote, companyName);
      if (side && fold(cleanCompetitorName(side)) !== fold(name)) return "its page's title names another company as the other side of the comparison";
    }
  }
  // Last: where the source stands (a data platform, a republisher with no allowed original…) — after the field's own checks, which say more.
  if (["news", "tags", "round", "competitor_declared", "competitor_market", "founder"].includes(r.field) && url) {
    const standing = roundSourceStanding(url, { companyName, isCompanySite: ownDomain(url, companyName), content: quote, headline: r.field === "news" ? r.after : null, acquirers: r.field === "news" ? [...(o.acquirers ?? []), ...(() => { const h = acquirerIn(String(r.after).replace(/^\d{4}-\d{2}-\d{2}\s+—\s+/, ""), companyName); return h ? [h.acquirer] : []; })()] : o.acquirers });
    if (standing.kind === "denied") return `its source is not allowed (${standing.why})`;
  }
  return null;
}

/** Drops what breaks a rule; merges one founder per person and one background fact per person and organisation; takes the lead investor out of a round no source names it in. */
export function applyRowRules<T extends RowLike>(rows: T[], companyName: string, today: string, o0: { domain?: string | null } = {}): { rows: T[]; dropped: string[] } {
  const dropped: string[] = [];
  // The buyers that several headlines of the company name: the buyer's own announcement is a party's, whatever the page's domain class says (owner, regression gate: Medipass / tyro.com).
  const o = { ...o0, acquirers: knownAcquirers(rows.filter((x) => x.field === "news").map((x) => String(x.after).replace(/^\d{4}-\d{2}-\d{2}\s+—\s+/, "")), companyName) };
  const kept: T[] = [];
  const locked = sectorDecision(companyName);
  for (const r0 of rows) {
    // A sector the owner locked (round 10: Dietly) stands whatever the memory or the model says.
    let r = r0;
    // The role is written only as far as the quote gives it (owner, 2026-11-23: Deliverect's CTO and CPO were written as CPO and President).
    if ((r.field === "founder" || r.field === "leader") && r.quote && r.after.includes(" — ")) {
      const [nm, ...rest] = r.after.split(" — "), title = rest.join(" — ");
      const fixed = titleMatchingQuote(title, r.quote);
      if (fixed !== title) {
        dropped.push(`${r.field}: ${nm} — role "${title}" → "${fixed || (r.field === "founder" ? "Founder" : "(none)")}": the quote does not give the rest`);
        if (!fixed && r.field === "leader") continue;
        r = { ...r, after: `${nm} — ${fixed || "Founder"}` };
      }
    }
    if (locked && r.field === "sector" && r.after !== locked.sector) { dropped.push(`sector: ${r.after} → ${locked.sector} (locked by the owner)`); r = { ...r, after: locked.sector }; }
    if (locked && r.field === "tags" && !r.after.split(/\s*,\s*/).includes(locked.sub_sector)) { dropped.push(`tags: ${r.after} → ${locked.sub_sector} (locked by the owner)`); r = { ...r, after: locked.sub_sector }; }
    // A round whose quote is an address, or that says "amount not disclosed" while its own announcement's address states one sum: the quote is the headline of the same
    // article among the company's news rows; with none, the round is not kept (missing is better than wrong).
    if (r.field === "round" && ((r.quote && looksLikeAddress(r.quote)) || /amount not disclosed/i.test(r.after))) {
      const amt = amountFromAddress(r.source_url ?? "");
      const news = rows.find((n) => n.field === "news" && n.source_url === r.source_url);
      const title = news ? news.after.replace(/^\d{4}-\d{2}-\d{2}\s+—\s+/, "") : "";
      const hasAmount = (t: string) => !!amt && extractNumbersFromText(t).some((n) => Math.abs(n - amt.amount) / amt.amount < 0.01);
      if (title && (!amt || hasAmount(title))) {
        if (amt && /amount not disclosed/i.test(r.after)) { dropped.push(`round: amount ${amt.label} read from the headline "${title.slice(0, 60)}"`); r = { ...r, after: r.after.replace(/amount not disclosed/i, amt.label) }; }
        r = { ...r, quote: title };
      } else if (/amount not disclosed/i.test(r.after) && amt) { dropped.push(`round: ${r.after.slice(0, 50)} — its address states ${amt.label} but no headline of the page is known to quote`); continue; }
      else if (r.quote && looksLikeAddress(r.quote)) { dropped.push(`round: ${r.after.slice(0, 50)} — its quote is an address`); continue; }
    }
    const why = r.field === "(nothing)" ? null : rowProblem(r, companyName, today, 0, o);
    if (why) { dropped.push(`${r.field}: ${String(r.after).slice(0, 60)} — ${why}`); continue; }
    // A round type no quote names is Unknown (owner, round 10): "Series A" for "raising $1.9m", "Other" for a round nothing calls strategic or crowdfunded.
    if (r.field === "round") {
      // "Debt" only when the source says debt, loan or facility (owner, 2026-11-19: Nordigen's $800K from two investors).
      if (/^Debt\b/.test(r.after) && !/\b(?:debt|loan|loans|lending facility|credit|facility|borrow\w*|notes?|bonds?|venture debt)\b/i.test(`${r.quote ?? ""} ${(() => { try { return ((JSON.parse(String(r.payload ?? "{}")) as { evidence?: Array<{ quote?: string }> }).evidence ?? []).map((e) => e.quote ?? "").join(" "); } catch { return ""; } })()}`)) {
        dropped.push("round: type Debt → Unknown — no quote says debt, loan or facility");
        r = { ...r, after: r.after.replace(/^Debt\b/, "Unknown") };
        if (r.payload) { try { const pl = JSON.parse(String(r.payload)); if (pl.round) pl.round.round_type = "Unknown"; r = { ...r, payload: JSON.stringify(pl) }; } catch { /* keep */ } }
      }
      const t = r.after.match(/^(Pre-Seed|Seed|Series [A-F]\+?|Growth|Bridge|Other)\b/)?.[1];
      if (t) {
        let amountQuote = r.quote ?? "";
        try { const pl = JSON.parse(String(r.payload ?? "{}")) as { evidence?: Array<{ field?: string; quote?: string }> }; amountQuote += " " + (pl.evidence ?? []).filter((e) => e.field === "amount_raised").map((e) => e.quote ?? "").join(" "); } catch { /* no payload */ }
        // The type is stated by the round's own quote, or by another source of the same event: a news headline of the company that names the type beside the same amount ("…Paradox Raises $200M Series C")
        // (owner, regression gate: Paradox). Unknown only when no source says it.
        const amountOfRow = (() => { const m = r.after.match(/\$([\d.,]+)\s*([KMB])?\b/i); if (!m) return null; const mult = m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "K" ? 1e3 : 1e6; return Number(m[1].replace(/,/g, "")) * mult; })();
        // The words of an address count as the page's own (owner, batch 8: lawhive's $60M — "…-raises-60m-series-b" in the addresses of bmmagazine and fortune).
        const sameEventRow = !amountOfRow ? undefined : rows.find((x) => {
          if (x.field !== "news" || fold(String(x.company ?? "")) !== fold(companyName)) return false;
          const text = `${x.after} ${x.quote ?? ""}`;   // the type comes from words of the page, never from its address (owner, 2026-11-19: lawhive's Series B)
          const labels = statedRoundLabels(text);
          if (!(t === "Other" ? labels.length > 0 : labels.includes(t))) return false;
          const fromAddress = amountFromAddress(x.source_url ?? "")?.amount;
          const sameAmount = extractNumbersFromText(`${x.after} ${x.quote ?? ""}`).some((n) => Math.abs(n - amountOfRow) / amountOfRow < 0.006) || (fromAddress != null && Math.abs(fromAddress - amountOfRow) / amountOfRow < 0.006);
          return sameAmount && !rowProblem(x, companyName, today, 0, o);
        });
        // A round typed "Other" (or "Unknown") whose event another source names ("Raises $200M Series C") takes that type; it is cited with it (the amount is in the headline as well).
        const newsType = sameEventRow && t === "Other" ? statedRoundLabels(`${sameEventRow.after} ${sameEventRow.quote ?? ""}`)[0] : undefined;
        if (newsType) {
          dropped.push(`round: type Other → ${newsType} — the headline of the same event states it`);
          r = { ...r, after: r.after.replace(/^Other\b/, newsType) };
          if (r.payload) { try { const pl = JSON.parse(String(r.payload)); if (pl.round) pl.round.round_type = newsType; r = { ...r, payload: JSON.stringify(pl) }; } catch { /* keep */ } }
        }
        const stated = !!sameEventRow || (t === "Other" ? refineRoundType("Other", amountQuote) === "Other" : statedRoundLabels(amountQuote).includes(t));
        // The source that states the type is cited with it: the round's quote and source become that headline and its page (the amount is in it as well).
        if (sameEventRow && (newsType || !statedRoundLabels(amountQuote).includes(t))) r = { ...r, quote: sameEventRow.after.replace(/^\d{4}-\d{2}-\d{2}\s+—\s+/, ""), source_url: sameEventRow.source_url };
        if (!stated) {
          dropped.push(`round: type ${t} → Unknown — no quote of the round names it`);
          r = { ...r, after: r.after.replace(/^[A-Za-z+\- ]+?(?= \$| amount)/, "Unknown") };
          if (r.payload) { try { const pl = JSON.parse(String(r.payload)); if (pl.round) pl.round.round_type = "Unknown"; r = { ...r, payload: JSON.stringify(pl) }; } catch { /* keep */ } }
        }
      }
    }
    if (r.field === "round" && r.payload) {
      const out = stripUngroundedLead(r);
      if (out.stripped) dropped.push(`round: lead investor ${out.stripped} taken out — no quote of the round names it`);
      kept.push(out.row as T); continue;
    }
    kept.push(r);
  }
  // one founder per person
  const founders = new Map<string, T>();
  const merged: T[] = [];
  const seenBg = new Set<string>();
  // An office that is a district of another office's city ("Jakarta Selatan" beside "Jakarta") is the same office (owner, batch 7: Hibank).
  {
    const DISTRICT = /^(?:selatan|utara|barat|timur|pusat|south|north|east|west|central|centre|center|sud|nord|ouest|est)$/i;
    const cityOf = (r: T) => String(r.after).split(",")[0].toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const offices = kept.filter((r) => r.field === "office");
    const drop = new Set<T>();
    for (const a of offices) for (const b of offices) {
      if (a === b) continue;
      const ca = cityOf(a), cb = cityOf(b);
      if (cb.length >= 4 && ca.startsWith(cb + " ") && DISTRICT.test(ca.slice(cb.length + 1))) { drop.add(a); dropped.push(`office: ${String(a.after).slice(0, 40)} is a district of ${String(b.after).slice(0, 30)} — merged`); }
    }
    if (drop.size) for (let i = kept.length - 1; i >= 0; i--) if (drop.has(kept[i])) kept.splice(i, 1);
  }
  const seenRound = new Map<string, T>();
  const seenComp = new Set<string>();
  const seenNews = new Map<string, T>();
  for (const r0 of kept) {
    let r = r0;
    if (r.field === "founder") {
      const [name, ...rest] = r.after.split(" — ");
      const key = fold(name), title = rest.join(" — ");
      const have = founders.get(key);
      if (!have) { founders.set(key, r); merged.push(r); continue; }
      const haveTitle = have.after.split(" — ").slice(1).join(" — ");
      if (title.length > haveTitle.length) have.after = `${name} — ${title}`;
      dropped.push(`founder: ${name} listed twice — merged`);
      continue;
    }
    if (r.field === "round") {
      // One row per company, type and amount; the most precise date stays (day over month over year over none).
      const key = roundKey(r);
      const have = seenRound.get(key);
      if (have) {
        dropped.push(`round: ${r.after.slice(0, 50)} listed twice — merged`);
        const better = datePrecision(r.after) > datePrecision(have.after) || (datePrecision(r.after) === datePrecision(have.after) && ((r.after.length > have.after.length) || (!have.quote && !!r.quote)));
        if (better) Object.assign(have, r);
        continue;
      }
      seenRound.set(key, r); merged.push(r); continue;
    }
    if (r.field === "news") {
      // One address, one news item: the fresh one over the remembered one, else the earlier date (owner, batch 6: Okra's two copies of the same article).
      const k = `${fold(r.company ?? "")}|${(r.source_url ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "")}`;
      // ... and one headline on one date is one item whatever the address (owner, batch 7: Inipharm's "…to Present Pharmacokinetic Data" twice).
      const kt = `${fold(r.company ?? "")}|T|${fold(r.after)}`;
      const have = seenNews.get(k) ?? seenNews.get(kt);
      seenNews.set(kt, have ?? r);
      if (have) {
        dropped.push(`news: ${r.after.slice(0, 50)} listed twice — merged`);
        const mem = (x: T) => /known_source/.test(String(x.origin ?? ""));
        if ((mem(have) && !mem(r)) || (mem(have) === mem(r) && r.after < have.after)) Object.assign(have, r);
        continue;
      }
      seenNews.set(k, r); merged.push(r); continue;
    }
    if (r.field === "competitor_declared" || r.field === "competitor_market") {
      const clean = cleanCompetitorName(r.after);
      const k = `${r.field}|${fold(r.company ?? "")}|${fold(clean)}`;
      if (seenComp.has(k)) { dropped.push(`${r.field}: ${r.after} listed twice — merged`); continue; }
      seenComp.add(k);
      if (clean !== r.after) r.after = clean;
      merged.push(r); continue;
    }
    if (r.field === "founder_background") {
      const m = r.after.match(/^(.*?):\s*([^—]+?)\s+—\s+(.*)$/);
      const key = m ? `${fold(m[1])}|${fold(m[2])}|${fold(m[3].split(",")[0])}` : fold(r.after);
      if (seenBg.has(key)) { dropped.push(`founder_background: ${r.after.slice(0, 50)} listed twice — merged`); continue; }
      seenBg.add(key);
    }
    merged.push(r);
  }
  // The same figure in the same words on several archive copies: the first and the last copy stay (the first dates it, the last shows it still stood), the ones between are merged
  // (owner, batch 6: Datahut's 42 on six dates).
  {
    const dateOf = (x: T) => x.after.match(/on (\d{4}-\d{2}-\d{2})/)?.[1] ?? "9999";
    const groups = new Map<string, T[]>();
    for (const r of merged) {
      if (r.field !== "headcount_history") continue;
      const m = r.after.match(/^(\d+\+?)\s+on\s+\d{4}-\d{2}-\d{2}/);
      if (!m) continue;
      const q = String(r.quote ?? "").replace(/&rsquo;|&amp;|&#\d+;/g, " ");
      const i = q.indexOf(m[1].replace("+", ""));
      const k = `${fold(r.company ?? "")}|${m[1]}|${fold(i >= 0 ? q.slice(Math.max(0, i - 12), i + 40) : q)}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const drop = new Set<T>();
    for (const g of groups.values()) {
      if (g.length < 3) continue;
      const sorted = [...g].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
      for (const mid of sorted.slice(1, -1)) { drop.add(mid); dropped.push(`headcount_history: ${mid.after.slice(0, 40)} is the same statement as ${sorted[0].after.slice(0, 40)} — merged`); }
    }
    if (drop.size) for (let i = merged.length - 1; i >= 0; i--) if (drop.has(merged[i])) merged.splice(i, 1);
  }
  // one value per single-valued field (owner, round 10: Medipass had two descriptions): the run's own over the memory's, else the first.
  const family = (f: string) => (f === "description_what_only" ? "description" : f);
  const SINGLE = new Set(["description", "sector", "founded_year", "hq_city", "hq_country", "founding_country", "employee_range", "employee_count"]);
  const fromMemory = (r: T) => /known_source/.test(String(r.origin ?? ""));
  const winner = new Map<string, T>();
  for (const r of merged) {
    const f = family(r.field);
    if (!SINGLE.has(f)) continue;
    const have = winner.get(f);
    if (!have || (fromMemory(have) && !fromMemory(r))) winner.set(f, r);
  }
  const final = merged.filter((r) => { const f = family(r.field); if (!SINGLE.has(f)) return true; if (winner.get(f) === r) return true; dropped.push(`${r.field}: ${String(r.after).slice(0, 50)} — a second value of a single-valued field`); return false; });
  return { rows: final, dropped };
}

function stripUngroundedLead<T extends RowLike>(r: T): { row: T; stripped: string | null } {
  let payload: { round?: Record<string, unknown>; evidence?: Array<{ quote?: string | null }> };
  try { payload = JSON.parse(r.payload as string); } catch { return { row: r, stripped: null }; }
  const lead = payload.round?.lead_investor;
  const name = typeof lead === "string" ? lead : (lead as { value?: string } | undefined)?.value;
  if (!name) return { row: r, stripped: null };
  const core = normalizeForMatch(name.replace(/\b(inc|ltd|llc|lp|llp|plc|gmbh|sa|ag|bv|co)\b\.?/gi, ""));
  const texts = [r.quote ?? "", ...(payload.evidence ?? []).filter((e) => (e as { field?: string }).field !== "lead_investor").map((e) => e.quote ?? "")].map((t) => normalizeForMatch(t));
  // A lead investor is named by a lead cue (owner, maintenance window 2026-11-20): "led by", "co-led" or "leading the round" within a sentence's reach of the name — not by being one of the investors.
  const rawTexts = [r.quote ?? "", ...(payload.evidence ?? []).filter((e) => (e as { field?: string }).field !== "lead_investor").map((e) => e.quote ?? "")];
  const bare = name.replace(/\b(inc|ltd|llc|lp|llp|plc|gmbh|sa|ag|bv|co)\b\.?/gi, "").trim().toLowerCase();
  const CUE = /\b(?:led by|co-?led|leading the round)\b/i;
  const led = (t: string) => { const i = t.toLowerCase().indexOf(bare); return bare.length >= 2 && i >= 0 && (CUE.test(t.slice(Math.max(0, i - 90), i + bare.length)) || CUE.test(t.slice(i, i + bare.length + 40))); };
  if (!core || (texts.some((t) => t.includes(core)) && rawTexts.some(led))) return { row: r, stripped: null };
  payload.round = { ...payload.round, lead_investor: null };
  return { row: { ...r, payload: JSON.stringify(payload), after: r.after.replace(new RegExp(`\\s*·\\s*lead\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "") }, stripped: name };
}

/**
 * The acquired row, derived only from the company's accepted news (owner, round 10: there is no separate extraction): a headline in which the company is the one acquired.
 * Any acquired row found another way is dropped by the caller first. The brand a company takes after the purchase is kept as brand_after_acquisition, never as a rename.
 */
export function acquiredFromNews<T extends RowLike>(rows: T[], companyName: string, companyId: string, events: Array<{ title: string; url: string; published_date?: string | null; event_buyer?: unknown; event_majority?: unknown }> = []): T | null {
  const articles = rows.filter((r) => r.field === "news").map((r) => {
    const m = r.after.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/);
    return { url: r.source_url ?? "", title: m?.[2] ?? r.after, content: "", date: m?.[1] ?? null };
  });
  // The purchase as the news gate read it (one event, its status and first date), when its representative is a row of the report.
  const acq = claimFromEvents(events.filter((e) => articles.some((a) => a.url === e.url))) ?? detectAcquisition(articles, companyName);
  if (!acq) return null;
  return { company_id: companyId, company: companyName, field: "acquired", before: "", after: `status = ${acq.status} · Acquired by ${acq.acquirer} (${acq.date ?? "undated"})`, source_url: acq.url, quote: acq.quote, origin: "news" } as unknown as T;
}

/** A closure read from the accepted news: one `acquired`-field row saying status = closed, with the headline as quote and its page as source. Null when an acquisition is stated (a purchase wins). */
export function closedFromNews<T extends RowLike>(rows: T[], companyName: string, companyId: string): T | null {
  const articles = rows.filter((r) => r.field === "news").map((r) => {
    const m = r.after.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/);
    return { url: r.source_url ?? "", title: m?.[2] ?? r.after, content: "", date: m?.[1] ?? null };
  });
  if (detectAcquisition(articles, companyName)) return null;
  const c = detectClosure(articles, companyName);
  if (!c) return null;
  return { company_id: companyId, company: companyName, field: "acquired", before: "", after: `status = closed · Closed (${c.date ?? "undated"})`, source_url: c.url, quote: c.quote, origin: "news" } as unknown as T;
}
