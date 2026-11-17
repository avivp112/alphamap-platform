/**
 * lib/enrichment/rowRules.ts — the same rules for every value of a report, whether this run found it or the memory of verified sources carried it (owner, round 10:
 * after a round of fixes the report was "exactly as before" — carried rows and injected values had never passed the new gates). Used on the memory when it is loaded
 * and on the final rows of every company.
 */
import { isListingOrSponsoredUrl } from "./pageKind.ts";
import { isExplainer, namesCompanyUpFront } from "./newsRelevance.ts";
import { foundedYearFromSite } from "./siteFacts.ts";
import { NOT_A_PRODUCT_SENTENCE } from "./quoteFinder.ts";
import { detectAcquisition } from "./acquisition.ts";
import { normalizeForMatch, quoteIsNotASentence } from "./evidence.ts";
import { sectorDecision } from "./techOverrides.ts";
import { sentenceIsAboutCompany, isThirdPartyPage, sentenceWithYear } from "./subject.ts";
import { vsTitleCompetitor, comparisonTitleCompetitor } from "./competitorTiers.ts";
import { amountFromAddress } from "./hints.ts";
import { extractNumbersFromText } from "./evidence.ts";
import { statedRoundLabels } from "./assemble.ts";
import { refineRoundType } from "./rounds.ts";

export interface RowLike { company?: string; field: string; after: string; source_url?: string | null; quote?: string | null; payload?: string | null; before?: string | null; [k: string]: unknown }

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const PERSON_PAGE = /\/(?:leadership|team|people|management|board|bio|biography|about\/team)\/[^/?#]+/i;

const brandOf = (companyName: string) => fold(companyName.replace(/\b(ai|inc|ltd|llc|labs?|group|studio|studios|technologies|software|systems)\b/gi, ""));
/** The source address is on the company's own domain (its name in the host). */
export function ownDomain(url: string | null | undefined, companyName: string): boolean {
  try { const h = new URL((url ?? "").startsWith("http") ? url! : `https://${url}`).hostname.toLowerCase(); const b = brandOf(companyName); return b.length >= 3 && fold(h).includes(b); } catch { return false; }
}
/** A competitor's name without a year or a bracket ("Dhan (2026)" → "Dhan"). */
export const cleanCompetitorName = (n: string): string => n.replace(/\s*\([^)]*\)/g, "").replace(/\s+(?:19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
const COMPETITOR_STOP = /^(?:the\s+)?(?:real[- ]estate|stocks?|shares?|equity|mutual funds?|bonds?|gold|silver|fixed deposits?|crypto(?:currency)?|etfs?|ipos?|forex|futures|options|insurance|loans?|savings|banks?|competitors?|alternatives?|tools?|software|platforms?)$/i;

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

/** Why this value may not stand under today's rules, or null. */
export function rowProblem(r: RowLike, companyName: string, today: string, weekBefore = 0): string | null {
  const url = r.source_url ?? "";
  if (r.quote && looksLikeAddress(r.quote)) return "its quote is an address, not text of the page";
  if (r.quote && quoteIsNotASentence(r.quote)) return "its quote is page code, not a sentence";
  const bad = isListingOrSponsoredUrl(url);
  if (bad) return bad === "sponsored_content" ? "its source is sponsored content" : "its source is a tag, list or search page, not the article";
  const quote = r.quote ?? "";
  if (r.field === "news") {
    const m = r.after.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/);
    const date = m?.[1] ?? null, title = (m?.[2] ?? r.after).trim();
    if (date && date >= today) return `its date (${date}) is the day of the run`;
    // The memory holds no page text to find a date in: a date in the week before the run is not kept from it (the run reads the page itself).
    if (date && weekBefore > 0 && date >= new Date(Date.parse(today) - weekBefore * 86_400_000).toISOString().slice(0, 10)) return `its date (${date}) is in the week before the run`;
    if (isExplainer(title)) return "a guide or explainer, not news";
    if (!namesCompanyUpFront({ title, content: "" }, companyName)) return "its headline does not name the company";
  }
  if (r.field === "founded_year") {
    if (/!\[|\]\(/.test(quote)) return "its quote is an image or a link";
    if (/\bsince\b/i.test(quote) && !foundedYearFromSite(quote)) return "\"since <year>\" here is not a founding statement";
    if (quote && !sentenceIsAboutCompany(sentenceWithYear(quote, r.after.trim()), companyName, { ownSite: ownDomain(url, companyName) })) return "its sentence is not about the company";
    if (isThirdPartyPage(url)) return "a customer, project or partner page does not say when the company was founded";
  }
  if (r.field === "tags") {
    if (!url) return "no source";
    if (NOT_A_PRODUCT_SENTENCE.test(quote)) return "its quote is not a product sentence";
    if (PERSON_PAGE.test(url)) return "a person's page does not support a tag";
    // A source that is not the company's own must be about the company: the brand is in its quote or its address.
    const brand = fold(companyName.replace(/\b(ai|inc|ltd|llc|labs?|group)\b/gi, ""));
    if (brand.length >= 3 && !fold(quote).includes(brand) && !fold(url).includes(brand)) return "its quote and address do not name the company";
  }
  if (r.field === "competitor_declared") {
    const name = cleanCompetitorName(r.after);
    if (COMPETITOR_STOP.test(name)) return "its name is an investment type or a category, not a company";
    // A comparison page counts only on the company's own domain, with its title naming the other side (xe.com's "mBank vs Xe", an IPO page, "Real Estate").
    if (/\bIPO\b/.test(quote) && !ownDomain(url, companyName)) return "an IPO page of another site";
    if (/\b(?:vs\.?|versus)\b/i.test(quote)) {
      if (!ownDomain(url, companyName)) return "a comparison page of another site";
      const side = vsTitleCompetitor(quote, companyName) ?? comparisonTitleCompetitor(quote, companyName);
      if (side && fold(cleanCompetitorName(side)) !== fold(name)) return "its page's title names another company as the other side of the comparison";
    }
  }
  return null;
}

/** Drops what breaks a rule; merges one founder per person and one background fact per person and organisation; takes the lead investor out of a round no source names it in. */
export function applyRowRules<T extends RowLike>(rows: T[], companyName: string, today: string): { rows: T[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept: T[] = [];
  const locked = sectorDecision(companyName);
  for (const r0 of rows) {
    // A sector the owner locked (round 10: Dietly) stands whatever the memory or the model says.
    let r = r0;
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
    const why = r.field === "(nothing)" ? null : rowProblem(r, companyName, today);
    if (why) { dropped.push(`${r.field}: ${String(r.after).slice(0, 60)} — ${why}`); continue; }
    // A round type no quote names is Unknown (owner, round 10): "Series A" for "raising $1.9m", "Other" for a round nothing calls strategic or crowdfunded.
    if (r.field === "round") {
      const t = r.after.match(/^(Pre-Seed|Seed|Series [A-F]\+?|Growth|Bridge|Other)\b/)?.[1];
      if (t) {
        let amountQuote = r.quote ?? "";
        try { const pl = JSON.parse(String(r.payload ?? "{}")) as { evidence?: Array<{ field?: string; quote?: string }> }; amountQuote += " " + (pl.evidence ?? []).filter((e) => e.field === "amount_raised").map((e) => e.quote ?? "").join(" "); } catch { /* no payload */ }
        const stated = t === "Other" ? refineRoundType("Other", amountQuote) === "Other" : statedRoundLabels(amountQuote).includes(t);
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
  const seenRound = new Map<string, T>();
  const seenComp = new Set<string>();
  for (const r of kept) {
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
  if (!core || texts.some((t) => t.includes(core))) return { row: r, stripped: null };
  payload.round = { ...payload.round, lead_investor: null };
  return { row: { ...r, payload: JSON.stringify(payload), after: r.after.replace(new RegExp(`\\s*·\\s*lead\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"), "") }, stripped: name };
}

/**
 * The acquired row, derived only from the company's accepted news (owner, round 10: there is no separate extraction): a headline in which the company is the one acquired.
 * Any acquired row found another way is dropped by the caller first. The brand a company takes after the purchase is kept as brand_after_acquisition, never as a rename.
 */
export function acquiredFromNews<T extends RowLike>(rows: T[], companyName: string, companyId: string): T | null {
  const articles = rows.filter((r) => r.field === "news").map((r) => {
    const m = r.after.match(/^(\d{4}-\d{2}-\d{2})\s+—\s+(.*)$/);
    return { url: r.source_url ?? "", title: m?.[2] ?? r.after, content: "", date: m?.[1] ?? null };
  });
  const acq = detectAcquisition(articles, companyName);
  if (!acq) return null;
  return { company_id: companyId, company: companyName, field: "acquired", before: "", after: `status = ${acq.status} · Acquired by ${acq.acquirer} (${acq.date ?? "undated"})`, source_url: acq.url, quote: acq.quote, origin: "news" } as unknown as T;
}
