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

import { namesCompany } from "./headcount";
import { samePersonName } from "./linkedin";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const NAME_RE = /^[A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){1,3}$/u;
const NOT_A_PERSON = /\b(inc|llc|ltd|corp|capital|ventures|partners|labs|technologies|university|group|holdings|fund|foundation|team|engineers|google|microsoft|amazon|meta|apple|money|bank|banking|payments?|finance|financial|media|systems|software|digital|global|networks?|solutions|studios?|games|investments?|management|consulting|insurance)\b/i;
// Sentence words that end up glued to a name when a sentence break is
// missed ("Mark Spera.  However").
const NOT_A_NAME_TOKEN = new Set(["however", "the", "and", "but", "this", "its", "their", "while", "after", "before", "since", "today", "also", "together", "both", "who", "which"]);

/** A sentence word glued to a name, or a whole word ending a sentence ("Spera."). */
function badNameToken(t: string): boolean {
  if (NOT_A_NAME_TOKEN.has(t.toLowerCase().replace(/[.,]$/, ""))) return true;
  return /^\p{L}{3,}\.$/u.test(t) && !/^(Prof|Mrs)\.$/.test(t);
}

/** A person's name: 2-4 capitalized tokens, no organisation words, no sentence words. */
function looksLikePersonName(p: string): boolean {
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
  for (const part of list.split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/)) {
    const name = cleanPersonName(part.trim().replace(/[.,]+$/, ""));
    if (!looksLikePersonName(name)) break;
    names.push(name);
  }
  return names.slice(0, 5);
}

// A role or relation written in front of a name: "CEO Adi Tatarko",
// "her husband Alon Cohen", "Dr. Reece Akhtar", "⚡ Roland Ligtenberg".
const NAME_PREFIX_RE = /^(?:(?:ceo|cto|coo|cfo|cmo|cpo|cro|president|chairman|chairwoman|chair|co-?\s?founder|founder|dr|mr|mrs|ms|prof|sir)\.?,?\s+)+/i;

/** The person's name alone: no leading symbols, titles or lowercase words. */
export function cleanPersonName(name: string): string {
  let n = name.replace(/^[^\p{L}]+/u, "").trim();
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
): { kept: T[]; dropped: Array<{ name: string; reason: FounderDropReason }> } {
  const kept: T[] = [];
  const dropped: Array<{ name: string; reason: FounderDropReason }> = [];
  for (const f of founders) {
    if (!f?.name) continue;
    if (investorNames.some((n) => n && samePersonName(n, f.name))) { dropped.push({ name: f.name, reason: "founder_is_investor" }); continue; }
    const grounded = sources.some((src) => {
      const text = `${src.title ?? ""}\n${src.content}`;
      if (foundersFromText(text, companyName, { url: src.url, title: src.title }).some((x) => samePersonName(x.name, f.name))) return true;
      const own = src.source_type === "company_site";
      return sentencesOf(text).some((s) => sentenceGroundsFounder(s, f.name, companyName, own));
    });
    if (grounded) kept.push(f);
    else dropped.push({ name: f.name, reason: "founder_not_grounded" });
  }
  return { kept, dropped };
}
