/**
 * lib/enrichment/subject.ts — a sentence is evidence about a company only when the company is its subject (owner, round 10, batch 6): the name, an alias, or "We / Our" on its own site.
 * "DHNY was founded in 2022" on Canopy's blog is about DHNY; "Founded in 1901, the Whitechapel Gallery …" on Spin Studio's project page is about the gallery. And a page of the company's own site
 * about its customers, projects, partners or case studies says nothing about the company's own founding, headquarters, founders or size.
 */
import { aliasesOf } from "./aliases.ts";

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const TAIL = /\s+(?:ai|inc|ltd|llc|labs?|group|studio|studios|technologies|technology|software|systems|app)$/i;

/** Pages of a company's own site that are about someone else: customers, projects, clients, partners, case studies, portfolio. */
export const THIRD_PARTY_PATH = /\/(?:projects?|case-stud(?:y|ies)|clients?|customers?|customer-stories?|work|our-work|portfolio|partners?|success-stories?|stories|testimonials?|references|showcase)(?:\/|$)/i;
export function isThirdPartyPage(url: string | null | undefined): boolean {
  if (!url) return false;
  try { return THIRD_PARTY_PATH.test(new URL(url.startsWith("http") ? url : `https://${url}`).pathname); } catch { return THIRD_PARTY_PATH.test(url); }
}

const namesIn = (text: string, name: string) => {
  const t = ` ${fold(text)} `, n = fold(name);
  return n.length >= 2 && (t.includes(` ${n} `) || t.includes(` ${n.replace(/ /g, "")} `));
};

/** True when the company (its name, the name without a generic tail, or an alias) is named in the sentence. */
export function sentenceNamesCompany(sentence: string, companyName: string, aliases: string[] = aliasesOf(companyName)): boolean {
  const names = [companyName, companyName.replace(TAIL, ""), ...aliases].filter((n) => n && n.trim().length >= 2);
  return names.some((n) => namesIn(sentence, n));
}

/**
 * The sentence's subject is the company: it names the company, or — on the company's own site — speaks as "we / our", or is a bare fragment of the structure
 * "Founded in 2013", "Since 2013", "Est. 2013" (a mark of the site itself).
 */
export function sentenceIsAboutCompany(sentence: string, companyName: string, o: { ownSite?: boolean; aliases?: string[] } = {}): boolean {
  const s = sentence.replace(/^\[machine translation\]\s*/i, "").trim();
  if (sentenceNamesCompany(s, companyName, o.aliases)) return true;
  if (!o.ownSite) return false;
  if (/\b(?:we|our|ours|us|we're|we’ve|we've)\b/i.test(s)) return true;
  return s.split(/\s+/).length <= 9 && /^(?:founded|since|est\.?|established)\b/i.test(s);
}
