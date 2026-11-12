/**
 * lib/enrichment/people.ts — deterministic, source-grounded helpers for
 * founders and leadership.
 *
 *   - foundersFromText(): "GoCo.io, Inc. was founded in 2015 by Jason J.
 *     Wang, Michael Gugel, and Nir Leibovich." The company must be the
 *     sentence's SUBJECT — "Rival X, founded by John Doe, competes with
 *     Gladia" names Gladia but not Gladia's founders. A sentence starting
 *     "It/The company was founded by" counts only on a page whose own title
 *     or URL names the company.
 *   - personMentionedIn(): a name appears in some text (accents, middle
 *     names/initials ignored) — used to require that a founder discovered
 *     from a LinkedIn headline is also named somewhere in the research.
 *   - cleanPeople(): drops entries without a surname ("Shannon") and
 *     duplicates of the same person.
 */

import * as cheerio from "cheerio";
import { namesCompany } from "./headcount";
import { samePersonName } from "./linkedin";
import { MAJOR_CITIES } from "./majorCities";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const NAME_RE = /^[A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){1,3}$/u;
const NOT_A_PERSON = /\b(inc|llc|ltd|corp|capital|ventures|partners|labs|technologies|university|group|holdings|fund|foundation|team|engineers|google|microsoft|amazon|meta|apple|money|bank|banking|payments?|finance|financial|media|systems|software|digital|global|networks?|solutions|studios?|games|investments?|management|consulting|insurance|healthcare|health|medical|imaging|pharma|pharmaceuticals?|therapeutics|biotech|electric|electronics|industries|motors|energy|robotics|aerospace|semiconductors?|instruments|devices)\b/i;
// Sentence words that end up glued to a name when a sentence break is
// missed ("Mark Spera.  However").
const NOT_A_NAME_TOKEN = new Set(["however", "the", "and", "but", "this", "its", "their", "while", "after", "before", "since", "today", "also", "together", "both", "who", "which"]);

/** A sentence word glued to a name, or a whole word ending a sentence ("Spera."). */
function badNameToken(t: string): boolean {
  if (NOT_A_NAME_TOKEN.has(t.toLowerCase().replace(/[.,]$/, ""))) return true;
  return /^\p{L}{3,}\.$/u.test(t) && !/^(Prof|Mrs)\.$/.test(t);
}

/** A person's name: 2-4 capitalized tokens, no organisation words, no sentence words. */
/** An organisation, not a person ("GE Healthcare", "Elbit Medical Imaging"). */
export const isOrganisationName = (name: string) => NOT_A_PERSON.test(name);

export function looksLikePersonName(p: string): boolean {
  return NAME_RE.test(p) && !NOT_A_PERSON.test(p) && !p.split(/\s+/).some(badNameToken);
}
const SUBJECT_GAP_WORDS = new Set(["was", "is", "were", "has", "been", "originally", "officially", "which", "that", "first", "initially", "a", "an", "the"]);

function sentencesOf(text: string): string[] {
  // A period after a single-letter initial ("Jason J. Wang") is not a sentence end.
  return text.split(/(?<=[\p{Ll}\d)"”]{2}[.!?])\s+(?=[A-Z"“])|\n+/u).map((x) => x.trim()).filter(Boolean);
}

function namesAfterBy(rest: string): string[] {
  const list = rest
    .replace(/\([^)]*\)/g, "")
    .split(/\b(?:in|on|back in|during)\s+(?:\d{4}|[A-Z][a-z]+ \d{4})\b|[;:]|\bto\b|\bwho\b|\bwith the\b/)[0];
  // The names run until the first item that is not one: "founded by A and
  // B, raised $8M ... angel investors C, D" are A and B — not C and D
  // (huskeys.io, 2026-10-18: a missed sentence break made the angels founders).
  const names: string[] = [];
  for (const raw of list.split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/)) {
    let part = raw.trim().replace(/[.,]+$/, "");
    // "Cyberstarts' Gili Raanan": someone of another organisation (an investor's
    // partner), named in passing — not a founder (eval run, 2026-10-29).
    if (/^\p{Lu}[\p{L}\d.&-]*['’]s?\s+\p{Lu}/u.test(part)) continue;
    // "OpenAI CTO Mira Murati": a role at another organisation in front of the name.
    part = part.replace(ORG_ROLE_PREFIX_RE, "");
    const name = cleanPersonName(part);
    // "…founded by A and B, Los Angeles": a place after the names, not a person (Apex, 2026-10-29).
    if (isPlaceName(name)) continue;
    if (!looksLikePersonName(name)) break;
    names.push(name);
  }
  return names.slice(0, 5);
}

// "former OpenAI CTO", "Google DeepMind researcher": an organisation and a role in front of a name.
const ORG_ROLE_PREFIX_RE = /^(?:(?:former|ex-?)\s+)?(?:\p{Lu}[\p{L}\d.&-]*\s+){1,3}(?:ceo|cto|coo|cfo|cmo|cpo|chief \w+ officer|vp|head of \w+|researcher|engineer|executive|director|partner|founder|co-?founder)\s+(?=\p{Lu})/iu;

/** A city name ("Los Angeles", "San Francisco"), never a person. */
function isPlaceName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return MAJOR_CITIES.has(n) || /^(new york|silicon valley|bay area|tel aviv|london|berlin|paris)\b/.test(n);
}

// A role or relation written in front of a name: "CEO Adi Tatarko",
// "her husband Alon Cohen", "Dr. Reece Akhtar", "⚡ Roland Ligtenberg".
const NAME_PREFIX_RE = /^(?:(?:ceo|cto|coo|cfo|cmo|cpo|cro|president|chairman|chairwoman|chair|co-?\s?founder|founder|dr|mr|mrs|ms|prof|sir)\.?,?\s+)+/i;

/** The person's name alone: no leading symbols, titles or lowercase words. */
export function cleanPersonName(name: string): string {
  // Invisible format characters (a right-to-left mark from a Hebrew page:
  // "Yonatan Boguslavsky\u200F", 2026-10-20) are never part of a name.
  let n = name.replace(/\p{Cf}/gu, "").replace(/^[^\p{L}]+/u, "").trim();
  for (let i = 0; i < 3; i++) {
    const before = n;
    n = n.replace(NAME_PREFIX_RE, "").replace(/^(?:\p{Ll}[\p{L}'’-]*\s+)+(?=\p{Lu})/u, "").trim();
    if (n === before) break;
  }
  return n.replace(/[\s,;]+$/, "");
}

const ROLE_WORDS = new Set([
  "co", "cofounder", "founder", "founders", "ceo", "cto", "coo", "cfo", "cmo", "cpo", "cro", "chief", "officer", "executive",
  "chairman", "chairwoman", "chair", "president", "vp", "vice", "head", "lead", "director", "managing", "general", "group",
  "global", "technical", "technology", "engineering", "product", "operations", "board", "member", "partner", "and", "of", "the", "at",
]);

/**
 * A founder's title that names another organisation ("Founder of BellQR",
 * "Founder Artu Capital") describes a different company — it becomes plain
 * "Founder"/"Co-founder". Role words and this company's own name are kept.
 */
export function cleanFounderTitle(title: string | null | undefined, companyName: string): string | null | undefined {
  if (!title) return title;
  const t = title.replace(/\([^)]*\)/g, " ").replace(/[\s,;]+$/, "").trim();
  if (!/founder/i.test(t)) return t;
  const rest = t.split(/[^\p{L}\p{N}.]+/u).filter(Boolean)
    .filter((w) => !ROLE_WORDS.has(w.toLowerCase().replace(/\.$/, "")))
    .join(" ");
  if (!rest || namesCompany(rest, companyName)) return t;
  return /co-?\s?founder/i.test(t) ? "Co-founder" : "Founder";
}

export function foundersFromText(
  text: string,
  companyName: string,
  page?: { url: string; title?: string },
): Array<{ name: string; title: string }> {
  const out: Array<{ name: string; title: string }> = [];
  const pageIsAboutCompany = !!page && (namesCompany(page.url, companyName) || (!!page.title && namesCompany(page.title, companyName)));
  const sentences = sentencesOf(text);
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const m = sentence.match(/\b(co-?\s?founded|founded)\b([^.]{0,40}?)\bby\s+(.+)$/i);
    if (!m) continue;
    const before = sentence.slice(0, m.index);
    let subjectOk = false;
    if (/^(it|the company|the startup|the firm|the business)\s*$/i.test(before.trim().replace(/\s+(was|is|were|has been)$/i, ""))) {
      // "It" is whatever the previous sentence was about: after "Dropbox is a
      // file hosting service.", "It was founded by Drew Houston" is Dropbox's.
      const antecedent = (sentences[i - 1] ?? "").match(/^([A-Z][\p{L}\d.&'’-]*(?:\s+[A-Z][\p{L}\d.&'’-]*){0,3})(?:\s+(?:is|was|has|had|offers|provides|became|builds|makes)\b|,)/u)?.[1];
      subjectOk = pageIsAboutCompany && (!antecedent || namesCompany(antecedent, companyName) ||
        /^(The|Its|Their|This|Our|Today|Now|Since|In|Last|Earlier|Recently|However|Additionally|Meanwhile|Currently|Previously|Founded|Based|Headquartered)\b/.test(antecedent));
    } else {
      // The company name must end right before "<was|is|...> founded".
      const words = fold(before)
        .replace(/\.(io|com|ai|co|org|net)\b/gi, " ")
        .replace(/\b(inc|llc|ltd|corp)\b\.?/gi, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/).filter(Boolean);
      while (words.length && SUBJECT_GAP_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
      const n = fold(companyName).replace(/\b(inc|llc|ltd|corp)\b\.?/gi, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
      subjectOk = n > 0 && words.length >= n && namesCompany(words.slice(-n).join(" "), companyName);
    }
    if (!subjectOk) continue;
    const title = /co-?\s?founded/i.test(m[1]) ? "Co-founder" : "Founder";
    for (const name of namesAfterBy(m[3])) {
      if (!out.some((o) => samePersonName(o.name, name))) out.push({ name, title });
    }
  }
  return out;
}

/**
 * Names a "founded by" sentence gives that the extraction did not — reported,
 * never added (owner, 2026-10-29: a founder comes only from the extraction,
 * with its evidence, like every field).
 */
export function founderNamesNotExtracted(
  extracted: Array<{ name?: string | null } | null | undefined>,
  sources: Array<{ url: string; title?: string; content: string }>,
  companyName: string,
): string[] {
  const out: string[] = [];
  for (const src of sources) {
    for (const f of foundersFromText(src.content, companyName, { url: src.url, title: src.title })) {
      if (extracted.some((x) => x?.name && samePersonName(x.name, f.name))) continue;
      if (!out.some((t) => samePersonName(t, f.name))) out.push(f.name);
    }
  }
  return out;
}

export function personMentionedIn(name: string, text: string): boolean {
  const tokens = fold(name).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1);
  if (tokens.length < 2) return false;
  const first = tokens[0], last = tokens[tokens.length - 1];
  return new RegExp(`\\b${first}\\b[^a-z]+(?:[a-z.]+[^a-z]+){0,2}${last}\\b`).test(fold(text).toLowerCase());
}

/**
 * Drops entries without a surname and folds duplicates of the same person
 * ("Mitchell Stewart" / "Mitch Stewart", "Albert Sebag" / "Albert Sebago")
 * into the first one, filling its empty fields from the duplicate.
 */
export function cleanPeople<T extends { name: string }>(people: T[]): T[] {
  const out: T[] = [];
  for (const raw of people) {
    const p = raw?.name ? { ...raw, name: cleanPersonName(raw.name) } : raw;
    if (!p?.name || fold(p.name).trim().split(/\s+/).filter((t) => /\p{L}{2,}/u.test(t)).length < 2) continue;
    // "Mark Spera.  However", "Virgin Money" — not a person's name.
    if (NOT_A_PERSON.test(p.name) || p.name.trim().split(/\s+/).some(badNameToken)) continue;
    const same = out.find((o) => samePersonName(o.name, p.name));
    if (same) {
      for (const [k, v] of Object.entries(p)) {
        const cur = (same as Record<string, unknown>)[k];
        if ((cur === undefined || cur === null || cur === "") && v !== undefined && v !== null && v !== "") (same as Record<string, unknown>)[k] = v;
      }
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

/**
 * A leadership entry needs a real role (owner's review, 2026-10-26: BETA got
 * "Joe Pagett — Employee (Department/Title not specified)"). No role, or a
 * placeholder / non-leadership one, and the person is not listed.
 */
export function isLeadershipRole(role: string | null | undefined): boolean {
  // A CLOSED list (owner, 2026-11-09, after the Orq "Tech Lead" and "Head of" entries): C-level, President,
  // Founder / Co-founder, General Manager, Managing Director, VP / SVP / EVP. Lead, Manager, Director (other than
  // Managing Director), Head of and anything else are not leaders. The board is kept apart (roleAtCompany).
  const r = (role ?? "").trim();
  if (!r) return false;
  if (/\b(not specified|unspecified|unknown|n\/a|none|employee|staff|team member|member of|intern|contractor|volunteer|student|candidate)\b/i.test(r)) return false;
  if (/\bchief\s+of\s+staff\b/i.test(r) && !/\b(ceo|cto|cfo|coo|founder|president)\b/i.test(r)) return false;
  return /\b(ceo|cto|cfo|coo|cmo|cpo|cro|cio|ciso|cdo|cso|cco|clo|chro|cxo|chief\b[\p{L} &,-]{0,40}\bofficer|president|founders?|co-?\s?founders?|general manager|managing director|vp|svp|evp|vice[- ]president)\b/iu.test(r);
}

/**
 * A "founder" whose bio says they were hired or appointed, and nothing
 * about founding (GreyNoise's "Ash Devata, CEO — was hired as CEO"), is
 * leadership, not a founder. A plain "CEO" title alone proves nothing —
 * founders are often listed by their current role.
 */
export function isFounderEntry(p: { title?: string | null; bio?: string | null }): boolean {
  if (/found/i.test(`${p.title ?? ""} ${p.bio ?? ""}`)) return true;
  return !/\b(hired|appointed|was named|named as|promoted|joined|brought in|took over|succeed(?:s|ed)?)\b/i.test(p.bio ?? "");
}

// ── Founders must be grounded ────────────────────────────────────────────────
// 2026-10-18 (huskeys.io): the extraction listed six ANGEL INVESTORS as the
// company's founders — the funding announcement introduced each one as
// "co-founder of Talon", "founder of Microsoft for Startups"... and
// cleanFounderTitle() then turned "Co-founder of Talon" into "Co-founder".
// The real founders, named in the same article, were two other people.
// Rule: a founder stays only when some source states that they founded THIS
// company; anyone named among the investors is never a founder.

const FOUNDER_WORD_RE = /\b(co-?\s?founders?|founders?|co-?\s?founded|founded|cofounded)\b/gi;
// "founder of Talon", "co-founder and CEO of Descope", "founded Demisto"
const FOUNDER_OF_OTHER_RE = /\b(?:co-?\s?founders?|founders?)(?:\s+(?:and|&)\s+(?:former\s+)?[\p{L}-]+)?\s+(?:of|at)\s+((?:[A-Z][\p{L}\d.&'’-]*)(?:\s+(?:[A-Z][\p{L}\d.&'’-]*|for|of))*)|\b(?:co-?\s?founded|founded|cofounded)\s+((?:[A-Z][\p{L}\d.&'’-]*)(?:\s+(?:[A-Z][\p{L}\d.&'’-]*|for|of))*)/gu;
const INVESTOR_WORD_RE = /\b(angels?|investors?|invested|investing|backed|backers?|participation|participated|led by|led the|round included|joined the round)\b/gi;

export interface FounderSource { content: string; title?: string; url: string; source_type?: string }

export type FounderDropReason = "founder_is_investor" | "founder_not_grounded";

function positions(re: RegExp, s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(new RegExp(re.source, re.flags))) out.push(m.index ?? 0);
  return out;
}

/** Character position of the person's name in the sentence, or -1. */
function nameIndex(name: string, sentence: string): number {
  const tokens = fold(name).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1);
  if (tokens.length < 2) return -1;
  const m = new RegExp(`\\b${tokens[0]}\\b[^a-z]+(?:[a-z.]+[^a-z]+){0,2}${tokens[tokens.length - 1]}\\b`).exec(fold(sentence).toLowerCase());
  return m ? m.index : -1;
}

/**
 * One sentence states that `name` founded `companyName`: a founder word near
 * the name that is not "founder of <another company>", with no investor word
 * between them, in a sentence that names the company — or anywhere on the
 * company's own website.
 */
export function sentenceGroundsFounder(sentence: string, name: string, companyName: string, onOwnSite: boolean): boolean {
  const at = nameIndex(name, sentence);
  if (at < 0) return false;
  if (!onOwnSite && !namesCompany(sentence, companyName)) return false;
  // Blank out "founder of <Other>" phrases, keeping positions intact.
  const masked = sentence.replace(FOUNDER_OF_OTHER_RE, (whole, org1?: string, org2?: string) => {
    const org = org1 ?? org2 ?? "";
    return namesCompany(org, companyName) ? whole : " ".repeat(whole.length);
  });
  const investorAt = positions(INVESTOR_WORD_RE, masked);
  return positions(FOUNDER_WORD_RE, masked).some((f) => {
    if (Math.abs(f - at) > 120) return false;
    const [lo, hi] = f < at ? [f, at] : [at, f];
    return !investorAt.some((i) => i > lo && i < hi);
  });
}

/**
 * Keeps the founders some source grounds (sentenceGroundsFounder, or the
 * strict foundersFromText "<Company> was founded by ..." pattern); drops
 * anyone named among the round's investors, and anyone no source grounds.
 */
export function groundFounders<T extends { name: string }>(
  founders: T[],
  sources: FounderSource[],
  companyName: string,
  investorNames: string[],
): { kept: Array<T & { grounded_url?: string }>; dropped: Array<{ name: string; reason: FounderDropReason }> } {
  const kept: Array<T & { grounded_url?: string }> = [];
  const dropped: Array<{ name: string; reason: FounderDropReason }> = [];
  for (const f of founders) {
    if (!f?.name) continue;
    if (investorNames.some((n) => n && samePersonName(n, f.name))) { dropped.push({ name: f.name, reason: "founder_is_investor" }); continue; }
    // The source that grounds the founder is kept with it (owner, 2026-11-02: every value with its source).
    const grounded = sources.find((src) => {
      // Another company's LinkedIn page ("linkedin.com/company/ceragem" for Ybrain) never grounds one.
      const li = src.url.match(/linkedin\.com\/company\/([^/?#]+)/i)?.[1]?.toLowerCase().replace(/[^a-z0-9]/g, "");
      const ownSlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (li && ownSlug.length >= 3 && !li.includes(ownSlug) && !ownSlug.includes(li)) return false;
      const text = `${src.title ?? ""}\n${src.content}`;
      if (foundersFromText(text, companyName, { url: src.url, title: src.title }).some((x) => samePersonName(x.name, f.name))) return true;
      const own = src.source_type === "company_site";
      return sentencesOf(text).some((s) => sentenceGroundsFounder(s, f.name, companyName, own));
    });
    if (grounded) kept.push({ ...f, grounded_url: grounded.url });
    else dropped.push({ name: f.name, reason: "founder_not_grounded" });
  }
  return { kept, dropped };
}

/** "Prof. Matt Niessner" → "Matt Niessner", "Dr. Elad Walach" → "Elad Walach" (owner, 2026-11-01: a founder's name, no title). */
export function stripHonorific(name: string): string {
  // "Kiwon Lee 님" (Ybrain, model check 2026-11-02): Korean / Japanese honorific suffixes too.
  return name.replace(/^\s*((prof|professor|dr|doctor|mr|mrs|ms|sir|dame)\.?\s+)+/i, "").replace(/\s*(님|씨|さん|様|先生|氏)\s*$/u, "").trim();
}

const BIO_STOPWORDS = new Set(["about", "after", "also", "among", "before", "being", "company", "where", "which", "while", "their", "there", "these", "those", "under", "since", "through", "within", "years", "other", "into", "from", "with", "that", "this", "have", "were", "will", "been", "more", "most", "such", "they", "them", "then", "than", "when", "what", "over", "both", "each", "only", "very", "well", "previously", "currently", "serves", "served", "including"]);
const stem = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 5);

/**
 * A bio keeps only the sentences its sources support (owner, 2026-11-02 — field review run 1:
 * Raycho Raychev's bio said "described as founded by a veteran", which no source says). A
 * sentence stays when every number and every capitalised name in it appears in the sources,
 * and at least two thirds of its other content words do (by stem). Null when nothing stays.
 */
const ROLES: Array<[RegExp, RegExp]> = [
  [/\b(vp|vice[- ]president)\b/i, /\b(vp|vice[- ]president)\b/i],
  [/\bceo\b|chief executive/i, /\bceo\b|chief executive/i],
  [/\bcto\b|chief technology|chief technical/i, /\bcto\b|chief technolog|chief technical/i],
  [/\bcoo\b|chief operating/i, /\bcoo\b|chief operating/i],
  [/\bcfo\b|chief financial/i, /\bcfo\b|chief financial/i],
  [/\bcmo\b|chief marketing/i, /\bcmo\b|chief marketing/i],
  [/\bcpo\b|chief product/i, /\bcpo\b|chief product/i],
  [/\bcro\b|chief revenue/i, /\bcro\b|chief revenue/i],
  [/founder|\bfounded\b/i, /founder|\bfounded\b/i],
  [/\bchair(man|woman|person)?\b/i, /\bchair/i],
];

/**
 * Every role a title or sentence gives a person (CEO, CTO, founder, VP…) is written beside
 * their name in one of the sources (field review runs 1–2: "Co-Founder & CEO, Unacademy Test
 * Prep", NPCx's CEO as "CTO", CData's CEO as "founder"). Beside: from 80 characters before
 * the name to 150 after it. A title without a known role passes.
 */
export function roleSupported(personName: string, roleText: string, sourceTexts: string[], otherPeople: string[] = []): boolean {
  // "Co-Founder & CEO" asks for both.
  const wanted = ROLES.filter(([inTitle]) => inTitle.test(roleText));
  if (!wanted.length) return true;
  const tokens = fold(personName).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1);
  if (tokens.length < 2) return false;
  const re = new RegExp(`\\b${tokens[0]}\\b[^a-z]+(?:[a-z.]+[^a-z]+){0,2}${tokens[tokens.length - 1]}\\b`, "g");
  // After the first mention an article says "Shetty", not "Nischal Shetty" (review 9: Crowdfire's CEO): the surname alone counts
  // in a source that names the person in full.
  const reLast = new RegExp(`\\b${tokens[tokens.length - 1]}\\b`, "g");
  const own = new Set(tokens);
  const others = [...new Set(otherPeople.flatMap((n) => fold(n).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 2 && !own.has(t))))];
  // Each role of the title needs a mention of the person that carries it, beside the name; the roles need not share one mention (run 11:
  // Scripbox's "Founder and CEO" was dropped when one article said "founder Atul Shinghal" and another "CEO Atul Shinghal").
  const satisfied = new Set<number>();
  const check = (text: string, rx: RegExp): boolean => {
    for (const m of text.matchAll(rx)) {
      const at = m.index ?? 0;
      let before = text.slice(Math.max(0, at - 80), at);
      let after = text.slice(at + m[0].length, at + m[0].length + 150);
      // Another person's name ends the window: on a team page the next card's title is theirs.
      for (const t of others) {
        const wre = new RegExp(`\\b${t}\\b`);
        const a = after.search(wre);
        if (a >= 0) after = after.slice(0, a);
        const b = [...before.matchAll(new RegExp(`\\b${t}\\b`, "g"))].pop();
        if (b?.index !== undefined) before = before.slice(b.index + t.length);
      }
      const window = before + m[0] + after;
      wanted.forEach(([, inSource], i) => { if (inSource.test(window)) satisfied.add(i); });
      if (satisfied.size === wanted.length) return true;
    }
    return false;
  };
  for (const raw of sourceTexts) {
    const text = fold(raw).toLowerCase();
    if (check(text, re)) return true;
    if (tokens[tokens.length - 1].length >= 4 && new RegExp(re.source).test(text) && check(text, reLast)) return true;
  }
  return false;
}

/**
 * The person's card on a page, by the HTML's structure (owner, 2026-11-03): from the element
 * that holds the name, up to the element that is one of a row of alike siblings (the cards of
 * a team grid) — never one holding another known person's name, never more than 500
 * characters. The text of each card found; empty when the name is not on the page.
 */
export function personCardsInHtml(html: string, personName: string, otherPeople: string[] = [], opts: { keepCase?: boolean; maxLen?: number } = {}): string[] {
  const maxLen = opts.maxLen ?? 500;
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, head").remove();
  // Elements are separate words ("<h3>Liron Bitan</h3><p>VP R&D</p>" is not "Bitanvp").
  $("body *").each((_, el) => { $(el).prepend(" ").append(" "); });
  const norm = (t: string) => fold(t).toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = norm(personName).split(/[^a-z]+/).filter((t) => t.length > 1);
  if (tokens.length < 2) return [];
  const nameRe = new RegExp(`\\b${tokens[0]}\\b[^a-z]+(?:[a-z.]+[^a-z]+){0,2}${tokens[tokens.length - 1]}\\b`);
  const otherRes = otherPeople.map((n) => norm(n).split(/[^a-z]+/).filter((t) => t.length > 1))
    .filter((t) => t.length >= 2 && !(t[0] === tokens[0] && t[t.length - 1] === tokens[tokens.length - 1]))
    .map((t) => new RegExp(`\\b${t[0]}\\b[^a-z]+(?:[a-z.]+[^a-z]+){0,2}${t[t.length - 1]}\\b`));
  const textOf = (el: cheerio.Cheerio<any>) => norm(el.text());
  const cards: string[] = [];
  // The innermost elements whose text holds the name.
  const holders = $("body *").filter((_, el) => nameRe.test(textOf($(el))) && !$(el).children().toArray().some((c) => nameRe.test(textOf($(c)))));
  holders.each((_, el) => {
    let node = $(el);
    for (let depth = 0; depth < 8; depth++) {
      const parent = node.parent();
      if (!parent.length || parent.is("body, html")) break;
      const tag = (node.prop("tagName") ?? "").toString();
      const cls = node.attr("class") ?? "";
      const alike = node.siblings().toArray().filter((sib) => (($(sib).prop("tagName") ?? "").toString() === tag) && ($(sib).attr("class") ?? "") === cls);
      // One card of a row of alike cards, and more than the name alone.
      if (alike.length > 0 && textOf(node).length > norm(personName).length + 2) break;
      const pText = textOf(parent);
      if (pText.length > maxLen || otherRes.some((r) => r.test(pText))) break;
      node = parent;
    }
    const t = opts.keepCase ? node.text().replace(/\s+/g, " ").trim() : textOf(node);
    if (textOf(node).length <= maxLen && !cards.includes(t)) cards.push(t);
  });
  return cards;
}

const PERSON_PRONOUN = /\b(he|she|his|her|him|they|their|them)\b/i;

export function supportedBio(bio: string, sourceTexts: string[], personName: string, otherPeople: string[] = []): string | null {
  const text = sourceTexts.join(" \n ");
  const hay = text.toLowerCase();
  const stems = new Set((text.match(/[\p{L}\p{N}]{4,}/gu) ?? []).map(stem));
  const own = new Set(personName.toLowerCase().split(/\s+/));
  const nameParts = personName.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const kept = bio.split(/(?<=[.!?])\s+/).filter((sentence) => {
    // About the person (field review run 2: "Databand was acquired by IBM in July 2022.").
    const lower = sentence.toLowerCase();
    if (!nameParts.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) && !PERSON_PRONOUN.test(sentence)) return false;
    // Its roles beside the person's name in a source.
    if (!roleSupported(personName, sentence, sourceTexts, otherPeople)) return false;
    const words: string[] = [...(sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'&.-]*/gu) ?? [])];
    const numbers = words.filter((w) => /^\d{2,}/.test(w));
    if (numbers.some((n) => !hay.includes(n.replace(/[.,]$/, "")))) return false;
    const names = words.slice(1).filter((w) => /^\p{Lu}/u.test(w) && !own.has(w.toLowerCase()) && w.length > 2);
    if (names.some((n) => !hay.includes(n.toLowerCase().replace(/[.,']+$/, "")))) return false;
    const content = words.filter((w) => w.length >= 5 && !/^\p{Lu}/u.test(w) && !/^\d/.test(w) && !BIO_STOPWORDS.has(w.toLowerCase()));
    if (!content.length) return true;
    const missing = content.filter((w) => !stems.has(stem(w))).length;
    return missing / content.length <= 1 / 3;
  });
  return kept.length ? kept.join(" ") : null;
}

/**
 * A person's role at THIS company (owner, 2026-11-04 — field review run 4, InfiniGrow's
 * "Board & Advisor; Founder & CMO, StreamElements"):
 *   - an advisor (advisor, advisory board) is not kept at all;
 *   - a board member is kept apart, as "Chairman" or "Board member" — never with a role at
 *     another company;
 *   - any other role keeps only its parts that are not a role at another company: "Founder,
 *     Sisense" never makes anyone a founder here. Nothing left: null.
 */
export function roleAtCompany(role: string | null | undefined, companyName: string): { kind: "advisor" | "board" | "leader"; role: string | null } {
  const raw = (role ?? "").trim();
  const ownName = fold(companyName).toLowerCase().replace(/\b(inc|ltd|llc|corp|gmbh|ag|bv)\b\.?/g, " ").trim();
  // Parts: "A; B", "A | B", "A · B".
  const parts = raw.split(/\s*(?:;|\||·)\s*/).filter(Boolean);
  const elsewhere = (part: string) => {
    const m = part.match(/(?:,|\bat\b|\bof\b|@)\s*([A-Z][\w.&' -]{1,40})$/);
    if (!m) return false;
    const org = fold(m[1]).toLowerCase().trim();
    if (/^(the )?(board|company|directors|advisors|advisory board)$/.test(org)) return false;
    return !(org.includes(ownName) || ownName.includes(org));
  };
  const own = parts.filter((p) => !elsewhere(p));
  const text = own.join("; ");
  if (/\badvis(?:or|er|ory)\b/i.test(text) || (!own.length && /\badvis(?:or|er|ory)\b/i.test(raw))) return { kind: "advisor", role: null };
  const executive = /\b(ceo|cto|coo|cfo|cmo|cpo|cro|chief|founder|co-?founder|president|vp|vice president|head|director of|general manager|managing director)\b/i.test(text);
  if (!executive && /\b(chair(?:man|woman|person)?|board)\b/i.test(text)) {
    return { kind: "board", role: /\bchair/i.test(text) ? "Chairman" : "Board member" };
  }
  return { kind: "leader", role: own.length ? text : null };
}


const CREDENTIALS = "phd|ph\\.d|md|m\\.d|mba|rd|cpa|esq|ms|msc|bsc|ma|jd|dds|dvm|pe|dr";
const TITLE_WORD = /\b(ceo|cto|coo|cfo|cmo|cpo|cro|ciso|chief|founder|co-?founder|president|vp|svp|evp|vice president|head|director|manager|lead|officer|partner|general manager|managing director)\b/i;
const ACRONYMS = new Set(["ceo", "cto", "coo", "cfo", "cmo", "cpo", "cro", "ciso", "vp", "svp", "evp", "gm", "us", "uk", "r&d", "ai", "hr", "it"]);

/**
 * The title a person's card gives when the extraction gave none (owner, 2026-11-06 — Quris AI's team page:
 * "Shelly Maman, PhD  Head of Strategic Alliances"): what follows the name and its credentials, up to the
 * first sentence stop, when it reads as a role. null when the card holds no such phrase. The card is the
 * lower-cased text personCardsInHtml returns.
 */
export function titleFromCard(personName: string, card: string): string | null {
  const tokens = fold(personName).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 1);
  if (tokens.length < 2) return null;
  const text = fold(card).toLowerCase().replace(/\s+/g, " ").trim();
  const nameEnd = new RegExp(`\\b${tokens[0]}\\b[^a-z]+(?:[a-z.]+[^a-z]+){0,2}${tokens[tokens.length - 1]}\\b`).exec(text);
  if (!nameEnd) return null;
  let rest = text.slice(nameEnd.index + nameEnd[0].length).replace(new RegExp(`^(?:[\\s,.]*\\b(?:${CREDENTIALS})\\b)+`, "i"), "").replace(/^[\s,.:;|·•–—-]+/, "");
  rest = rest.split(/[.;|·•\n]|\s{2,}| [-–—] /)[0].trim();
  const words = rest.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 9 || !TITLE_WORD.test(rest)) return null;
  return words.map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : /^(of|and|the|for|in|at|&)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ").replace(/\bR&d\b/g, "R&D");
}


const CARD_NOISE = /\b(?:read (?:more|less)|show (?:more|less)|view (?:full )?(?:bio|profile)|learn more|see (?:more|bio)|linkedin|twitter|x\.com|follow|connect|close)\b|[×✕✖]/gi;
const BIO_CUE = /\b(?:experience|previously|prior to|before (?:joining|founding|that)|founded|co-?founded|served|led|leads|joined|worked|holds|degree|graduat\w+|ph\.?d|mba|studied|university|college|years|career|expertise|background|veteran|managed|built|launched|headed|oversees|responsible|began|started|earned)\b/i;
/**
 * What makes text a person's BACKGROUND (owner, 2026-11-12, run 10): past roles, experience, education, military service. A description of the
 * current role, or a quote of the person ("We're not selling a technology"), is not one (Swimm's Oren Toledano).
 */
export const BIO_BACKGROUND = /\b(?:previously|prior to|formerly|before (?:joining|founding|that|this)|ex-|alum(?:nus|ni|na)?|graduat\w+|ph\.?d|mba|m\.?d\.?|degree|studied|alma mater|\d+\+?\s+years|years of experience|decades?|career|veteran|served|worked (?:at|for|as|with|on)|held (?:roles|positions|senior)|spent|(?:began|started) (?:his|her|their) career|earned|turned|background|experience (?:in|at|as|with)|(?:was|were) (?:a|an|part of|the|among)|unit \d+|idf|special forces)\b/i;
const PRONOUN = /\b(?:he|she|they|his|her|their)\b/i;
const TITLES = /\b(?:ceo|cto|coo|cfo|cmo|cpo|cro|ciso|chief [a-z]+ officer|founder|co-?founder|president|vp|svp|evp|vice president|head of|general manager|managing director)\b/gi;
/**
 * The biography a team page's card carries, word for word (owner, 2026-11-10): the card's text, with only its header (the person's
 * name and title at the start) and the page's buttons taken off. The name stays wherever the text uses it. null unless what is left
 * is about this person: it names or points to them (name, he/she), reads as a biography (roles, experience, education), is not a
 * menu of several people, does not name another person of the company, and is not the company's marketing.
 */
export function bioFromCard(card: string, personName: string, title?: string | null, otherPeople: string[] = []): string | null {
  const original = card.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  const parts = fold(personName).split(/[^A-Za-z]+/).filter((x) => x.length > 1);
  if (parts.length < 2) return null;
  const first = parts[0], last = parts[parts.length - 1];
  const nameAnywhere = new RegExp(`${first}[^A-Za-z]+(?:[A-Za-z.]+[^A-Za-z]+){0,2}${last}`, "i");
  if (!nameAnywhere.test(fold(original))) return null;
  // Only a header at the start is removed: honorific, name, credentials, then the title.
  let t = original.replace(CARD_NOISE, " ").replace(/\s+/g, " ").trim();
  const header = new RegExp(`^(?:(?:dr|prof|professor|mr|mrs|ms)\\.?\\s+)?${first}[^A-Za-z]+(?:[A-Za-z.]+[^A-Za-z]+){0,2}${last}(?:\\s*,?\\s*(?:${CREDENTIALS}))*[\\s,.:;|·•–—-]*`, "i");
  t = t.replace(header, "");
  if (title) t = t.replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}[\\s,.:;|·•–—-]*`, "i"), "");
  t = t.replace(/^[\s,.:;|·•–—-]+/, "").trim();
  // The name was the subject of the first sentence ("Krish Subramanian, CEO & Co-founder at Chargebee, leverages …"): keep it.
  if (/^[a-z]/.test(t)) {
    const at = fold(original.replace(CARD_NOISE, " ")).search(nameAnywhere);
    t = original.replace(CARD_NOISE, " ").replace(/\s+/g, " ").trim().slice(Math.max(0, at)).trim();
    // A heading with the name, then a paragraph that begins with it: the name once.
    t = t.replace(/^([\p{L}.' -]{5,60}?)\s+\1(?=[,\s])/u, "$1");
  }
  const words = t.split(/\s+/).filter(Boolean);
  const sentences = t.split(/(?<=[.!?])\s+/).filter((x) => x.split(/\s+/).length >= 6);
  if (t.length < 90 || words.length < 14 || !sentences.length) return null;
  // About this person: the name in the text, or he / she / they.
  const lastOnly = new RegExp(`\\b${last}\\b`, "i");
  if (!lastOnly.test(fold(t)) && !new RegExp(`\\b${first}\\b`, "i").test(fold(t)) && !PRONOUN.test(t)) return null;
  if (!BIO_CUE.test(t)) return null;
  if (!BIO_BACKGROUND.test(t)) return null;   // only the current role, or a quote of the person: not a background
  // A menu or a row of people (Tevel's "Our Team Our Team … Chief Financial Officer … Chief Operations Officer …").
  if (/\b(\w+ \w+)\s+\1\b/i.test(t.slice(0, 80)) && /\bour team\b/i.test(t)) return null;
  if ((t.match(TITLES) ?? []).length > 3) return null;
  // Another person of the company in the text: a shared paragraph (ConductorOne's "Alex Bovee and Paul Querna met …").
  for (const o of otherPeople) {
    const ol = fold(o).split(/[^A-Za-z]+/).filter((x) => x.length > 2).pop();
    if (ol && ol.toLowerCase() !== last.toLowerCase() && new RegExp(`\\b${ol}\\b`, "i").test(fold(t))) return null;
  }
  if (t.length <= 900) return t;
  const cut = t.slice(0, 900);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 200 ? cut.slice(0, end + 1) : null;
}
