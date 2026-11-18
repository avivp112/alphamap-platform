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

/** Words that describe what a company does or is, not who it is: "Ardens Health Informatics" is "Ardens", "Nilo Saúde" is "Nilo" (owner, batch 7). */
const GENERIC_WORDS = new Set(["health", "healthcare", "informatics", "saude", "saúde", "medical", "medicine", "pharma", "pharmaceuticals", "therapeutics", "biosciences", "sciences", "bio", "technology", "technologies", "tech", "software", "systems", "solutions", "services", "digital", "group", "holdings", "international", "global", "studio", "studios", "labs", "lab", "analytics", "data", "capital", "finance", "financial", "ventures", "partners", "security", "networks", "media", "games", "game", "mobility", "energy", "bank", "money", "pay", "payments", "logistics", "robotics", "ai", "inc", "ltd", "llc", "limited", "gmbh", "sa", "ltda", "plc", "co", "company", "and", "&"]);
/** The name with its trailing generic words taken off, when what is left is a name of its own (4 letters or more): ["Ardens"] for "Ardens Health Informatics". */
export function shortNames(companyName: string): string[] {
  const words = companyName.trim().split(/\s+/);
  const out: string[] = [];
  for (let n = words.length - 1; n >= 1; n--) {
    const tailWord = fold(words[n]).replace(/ /g, "");
    if (!GENERIC_WORDS.has(tailWord)) break;
    const short = words.slice(0, n).join(" ");
    if (fold(short).replace(/ /g, "").length >= 4 && !GENERIC_WORDS.has(fold(short))) out.push(short);
  }
  return out;
}

/** True when the company (its name, the name without a generic tail, or an alias) is named in the sentence. */
export function sentenceNamesCompany(sentence: string, companyName: string, aliases: string[] = aliasesOf(companyName)): boolean {
  const names = [companyName, companyName.replace(TAIL, ""), ...shortNames(companyName), ...aliases].filter((n) => n && n.trim().length >= 2);
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
  // Subject forms only: "Contact us" and "canopycare.us" are an object and a domain, not the company speaking.
  if (/(?<![\w.@])(?:we|our|ours|we're|we’ve|we've)(?![\w.@])/i.test(s)) return true;
  // A fragment that is a mark of the site itself: a keyword at its start, or after a few words with no verb ("Proudly educating since 2020", "Date of Establishment. October 24, 2014") — not "DHNY was founded in 2022".
  { const m = s.match(/^(.*?)\b(?:founded|since|est\.?|established|establishment|incorporated)\b/i);
    if (s.split(/\s+/).length <= 9 && m && m[1].trim().split(/\s+/).filter(Boolean).length <= 4 && !/\b(?:was|were|is|are|has|had|been)\b/i.test(m[1])) return true; }
  // The company spoken of as "the company" on its own pages ("A empresa foi fundada…", "La société a été fondée…").
  return PRONOUN_SUBJECT.test(s);
}

/** "The company", "A empresa", "La société", "L'entreprise", "Das Unternehmen" … : the company without its name. */
export const PRONOUN_SUBJECT = /(?<![\p{L}])(?:(?:the|this)\s+(?:company|startup|start-up|firm|business)|(?:a|esta|la|nossa)\s+(?:empresa|startup|companhia)|la\s+(?:société|societe|compagnie|start-?up)|l['’](?:entreprise|société)|das\s+unternehmen|die\s+(?:firma|gesellschaft)|nasza\s+(?:firma|spółka))(?![\p{L}])/iu;

/**
 * A founding year's sentence (owner, batch 7): its subject is the company by its name or short name, by "we" on its own site, by a label of the site itself ("Date of Establishment. October 24, 2014"),
 * by "the company" / "A empresa" / "La société" on a page that is about the company (its own site, or a page whose address or title carries its name), and by "It was founded" on a profile page of the company
 * (…/company/luvly). Nothing else: "DHNY was founded in 2022" is about DHNY.
 */
export function foundingSentenceIsAboutCompany(quote: string, year: number | string, companyName: string, o: { ownSite?: boolean; url?: string | null; title?: string | null; aliases?: string[] } = {}): boolean {
  const sentence = sentenceWithYear(quote, year);
  if (sentenceIsAboutCompany(sentence, companyName, { ownSite: o.ownSite, aliases: o.aliases })) return true;
  // A short run of labels ("Mama Money. mamamoney.co.za. Founded: 2013. Co-Founders") names the company in the part before the year.
  if (quote.length <= 220 && sentence.split(/\s+/).length <= 6 && sentenceNamesCompany(quote, companyName, o.aliases)) return true;
  const fv = (x: string) => fold(x).replace(/ /g, "");
  const nameKeys = [companyName, ...shortNames(companyName)].map(fv).filter((k) => k.length >= 4);
  const hay = fv(`${o.url ?? ""} ${o.title ?? ""}`);
  const pageIsAboutIt = !!o.ownSite || (!!o.url && !isThirdPartyPage(o.url) && nameKeys.some((k) => hay.includes(k)));
  if (pageIsAboutIt && PRONOUN_SUBJECT.test(sentence)) return true;
  if (pageIsAboutIt && /^(?:it|ela|ele|elle|il|es)\s+(?:was|foi|a été|fue|wurde)\b/i.test(sentence.trim()) && /\/(?:company|companies|profile|profiles|empresas?|startups?|organi[sz]ations?|c)\/[^/?#]+\/?$/i.test((o.url ?? "").replace(/[?#].*$/, ""))) return true;
  return false;
}

/** The part of a stitched quote ("... ... ...") or of a long one that holds the year: the sentence the founding year stands on. */
export function sentenceWithYear(quote: string, year: number | string): string {
  // A legal suffix's dot ("Estimote, Inc. was founded in 2012") does not end the sentence.
  const masked = quote.replace(/\b(inc|ltd|llc|corp|co|s\.a|s\.r\.l|gmbh|ag|pty|sp|z o\.o|b\.v|n\.v|a\.s|oy|ab|plc|ltda|sas|srl|sa)\./gi, (m) => m.replace(".", "\u0000"));
  const parts = masked.split(/\s\.\.\.\s|(?<=[.!?])\s+/).map((x) => x.replace(/\u0000/g, ".").trim()).filter(Boolean);
  const i = parts.findIndex((x) => x.includes(String(year)));
  if (i < 0) return quote;
  // A label and its value are two "sentences" ("Date of Establishment. October 24, 2014"; "Mama Money. mamamoney.co.za. Founded: 2013."): the short parts before it belong to it.
  let from = i;
  while (from > 0 && i - from < 3 && parts[from].split(/\s+/).length <= 5 && parts[from - 1].split(/\s+/).length <= 5) from--;
  return parts.slice(from, i + 1).join(" ");
}
