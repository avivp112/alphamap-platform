/**
 * lib/enrichment/patents.ts — a patent is the company's only when a source
 * says so (owner's review of the 2026-10-26 run).
 *
 * The run kept any patent a source mentioned: 1AHEAD got Snap's "Image based
 * tracking in augmented reality systems", AS0001 got "High speed processing
 * of financial information using FPGA" off a USPTO gazette page listing
 * thousands of patentees, Azumo got US11442213B2 linked to US20060061008A1.
 *
 * Now a patent is kept only when:
 *   1. it is identified — a patent number, or a Google Patents URL that
 *      carries one; when both are given they must be the same patent;
 *   2. it is tied to the company — a source shows the number within a few
 *      lines of the company's name (an assignee line, an article about the
 *      company), or the source is a page about the company itself (its own
 *      website, or a patent page whose address names the company).
 * A count ("holds 47 patents") and the patents' fields need the company's
 * name nearby too. Pure; tested with the run's own cases.
 */
import type { LabeledSource } from "./sources";

export interface PatentClaim { title: string; patent_number?: string; filing_date?: string; url?: string; summary?: string }

export type PatentDrop = "patent_unidentified" | "patent_number_url_mismatch" | "patent_not_the_company";

const LEGAL = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|ag|sa|s\.a|sas|bv|b\.v|plc|pty|oy|ab|srl|spa|kk|holdings?|group)\b\.?/gi;

/** "AS0001, Inc." → "as0001"; "BETA AIR LLC" → "betaair". */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(LEGAL, " ").replace(/[^\p{L}\p{N}]/gu, "");
}

const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** The patent number in a Google Patents (or similar) URL: …/patent/US11756357B2/en → US11756357B2. */
export function numberFromUrl(url: string | undefined): string | null {
  const m = url?.match(/\/patent\/([A-Z]{2}[A-Z0-9]+?)(?:\/|$|\?)/i);
  return m ? m[1].toUpperCase() : null;
}

/** The digits that identify a patent across spellings: "US 11,756,357 B2" / "US11756357B2" → "11756357". */
export function patentDigits(number: string): string {
  const m = number.toUpperCase().replace(/[\s,.-]/g, "").match(/^[A-Z]{2}(\d+)/);
  return m ? m[1].replace(/^0+/, "") : number.replace(/\D/g, "");
}

export interface PatentContext {
  companyName: string;
  /** The company's own domain, when known ("azumotech.com"). */
  domain?: string | null;
}

/** A page about the company itself: its own website, or a URL that names it (patents.justia.com/assignee/azumo-inc). */
function aboutCompany(src: LabeledSource, ctx: PatentContext): boolean {
  if (src.source_id.startsWith("W")) return true;
  const key = nameKey(ctx.companyName);
  const url = compact(src.url);
  if (key.length >= 4 && url.includes(key)) return true;
  const stem = ctx.domain?.toLowerCase().replace(/^www\./, "").split(".")[0];
  return !!stem && stem.length >= 4 && url.includes(compact(stem));
}

/**
 * The company's name within ~300 characters of `digits`, with no OTHER patent
 * number between the two — on a list page ("Acme … 12,470,594 … Bolt …
 * 10,169,814") each number belongs to the name right before it, not to every
 * name nearby.
 */
function nearCompany(text: string, digits: string, ctx: PatentContext): boolean {
  const key = nameKey(ctx.companyName);
  if (key.length < 3) return false;
  const flat = compact(text);
  const otherNumber = (between: string) => (between.match(/\d{6,9}/g) ?? []).some((n) => !n.includes(digits) && !key.includes(n));
  for (let at = flat.indexOf(digits); at >= 0; at = flat.indexOf(digits, at + 1)) {
    const from = Math.max(0, at - 300);
    const before = flat.slice(from, at);
    const nameBefore = before.lastIndexOf(key);
    if (nameBefore >= 0 && !otherNumber(before.slice(nameBefore + key.length))) return true;
    const after = flat.slice(at + digits.length, at + digits.length + 300);
    const nameAfter = after.indexOf(key);
    if (nameAfter >= 0 && !otherNumber(after.slice(0, nameAfter))) return true;
  }
  return false;
}

const sourceText = (s: LabeledSource) => `${s.title ?? ""} ${s.content}`;

/** null: keep the patent (with its number filled from the URL if it had none); otherwise why it goes. */
export function checkPatent(p: PatentClaim, sources: LabeledSource[], ctx: PatentContext): { patent: PatentClaim; drop: null } | { patent: null; drop: PatentDrop } {
  const fromUrl = numberFromUrl(p.url);
  const given = p.patent_number?.trim() || null;
  if (!given && !fromUrl) return { patent: null, drop: "patent_unidentified" };
  if (given && fromUrl && patentDigits(given) !== patentDigits(fromUrl)) return { patent: null, drop: "patent_number_url_mismatch" };
  const number = given ?? fromUrl!;
  const digits = patentDigits(number);
  if (digits.length < 5) return { patent: null, drop: "patent_unidentified" };

  const owned = sources.some((s) => {
    const text = sourceText(s);
    if (!compact(text).includes(digits) && !(p.url && s.url === p.url)) return false;
    return aboutCompany(s, ctx) || nearCompany(text, digits, ctx);
  });
  if (!owned) return { patent: null, drop: "patent_not_the_company" };
  return { patent: { ...p, patent_number: number }, drop: null };
}

/** A stated count or field belongs to the company only with its name in the same passage (~300 characters). */
export function statedForCompany(phrase: string, sources: LabeledSource[], ctx: PatentContext): boolean {
  const key = nameKey(ctx.companyName);
  const needle = compact(phrase);
  if (!needle || key.length < 3) return false;
  return sources.some((s) => {
    const flat = compact(sourceText(s));
    if (aboutCompany(s, ctx) && flat.includes(needle)) return true;
    let at = flat.indexOf(needle);
    while (at >= 0) {
      if (flat.slice(Math.max(0, at - 300), at + needle.length + 300).includes(key)) return true;
      at = flat.indexOf(needle, at + 1);
    }
    return false;
  });
}

/** "holds 47 patents" with the company's name in the same passage, or on a page about the company. */
export function countStatedForCompany(count: number, sources: LabeledSource[], ctx: PatentContext): boolean {
  const key = nameKey(ctx.companyName);
  const n = `(?:${count}|${count.toLocaleString("en-US")})`;
  const res = [
    new RegExp(`\\b${n}\\+?\\s+(?:[A-Za-z-]+\\s+){0,3}patents?\\b`, "gi"),
    new RegExp(`\\bpatents?\\b[^.\\d]{0,25}\\b${n}\\b`, "gi"),
  ];
  return sources.some((s) => {
    const text = sourceText(s);
    for (const re of res) {
      for (const m of text.matchAll(re)) {
        if (aboutCompany(s, ctx)) return true;
        const window = compact(text.slice(Math.max(0, m.index! - 300), m.index! + m[0].length + 300));
        if (key.length >= 3 && window.includes(key)) return true;
      }
    }
    return false;
  });
}
