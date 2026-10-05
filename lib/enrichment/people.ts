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
const NOT_A_PERSON = /\b(inc|llc|ltd|corp|capital|ventures|partners|labs|technologies|university|group|holdings|fund|foundation|team|engineers|google|microsoft|amazon|meta|apple)\b/i;
const SUBJECT_GAP_WORDS = new Set(["was", "is", "were", "has", "been", "originally", "officially", "which", "that", "first", "initially", "a", "an", "the"]);

function sentencesOf(text: string): string[] {
  // A period after a single-letter initial ("Jason J. Wang") is not a sentence end.
  return text.split(/(?<=[\p{Ll}\d)"”]{2}[.!?])\s+(?=[A-Z"“])|\n+/u).map((x) => x.trim()).filter(Boolean);
}

function namesAfterBy(rest: string): string[] {
  const list = rest
    .replace(/\([^)]*\)/g, "")
    .split(/\b(?:in|on|back in|during)\s+(?:\d{4}|[A-Z][a-z]+ \d{4})\b|[;:]|\bto\b|\bwho\b|\bwith the\b/)[0];
  return list
    .split(/,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/)
    .map((p) => p.trim().replace(/[.,]+$/, ""))
    .filter((p) => NAME_RE.test(p) && !NOT_A_PERSON.test(p))
    .slice(0, 5);
}

export function foundersFromText(
  text: string,
  companyName: string,
  page?: { url: string; title?: string },
): Array<{ name: string; title: string }> {
  const out: Array<{ name: string; title: string }> = [];
  const pageIsAboutCompany = !!page && (namesCompany(page.url, companyName) || (!!page.title && namesCompany(page.title, companyName)));
  for (const sentence of sentencesOf(text)) {
    const m = sentence.match(/\b(co-?\s?founded|founded)\b([^.]{0,40}?)\bby\s+(.+)$/i);
    if (!m) continue;
    const before = sentence.slice(0, m.index);
    let subjectOk = false;
    if (/^(it|the company|the startup|the firm|the business)\s*$/i.test(before.trim().replace(/\s+(was|is|were|has been)$/i, ""))) {
      subjectOk = pageIsAboutCompany;
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

export function cleanPeople<T extends { name: string }>(people: T[]): T[] {
  const out: T[] = [];
  for (const p of people) {
    if (!p?.name || fold(p.name).trim().split(/\s+/).filter((t) => /\p{L}{2,}/u.test(t)).length < 2) continue;
    if (out.some((o) => samePersonName(o.name, p.name))) continue;
    out.push(p);
  }
  return out;
}
