/**
 * lib/enrichment/translate.ts — a page that is not in English is translated before it is verified against (owner, round 10: Sami, STC, Conotoxia, Dietly — descriptions and founders
 * were dropped because the model's English sentence shares no word with a Portuguese, Arabic or Polish page).
 * The translation is appended to the page's own text ("[English translation]" and then the text), so every check that reads English (description support, founders, headquarters,
 * founding year) finds it, and the original stays beside it. A quote taken from the translated half is marked as a machine translation in field_provenance.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { requestFor } from "./models.ts";

export const TRANSLATION_MARK = "\n\n[English translation]\n";

const EN_WORDS = new Set(["the", "and", "of", "to", "in", "for", "with", "is", "are", "we", "our", "you", "your", "on", "by", "that", "this", "from", "at", "as", "it", "an", "be", "or", "can", "has", "have", "more", "all", "about"]);
const NON_LATIN = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Greek}]/gu;

/** True when the text is English (or too short to tell): a share of common English words, and little text in another script. */
export function looksEnglish(text: string): boolean {
  const sample = text.replace(/https?:\/\/\S+/g, " ").slice(0, 3000);
  const letters = (sample.match(/\p{L}/gu) ?? []).length;
  if (letters < 120) return true;
  if (((sample.match(NON_LATIN) ?? []).length / letters) > 0.3) return false;
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  return en / Math.max(1, words.length) >= 0.08;
}

export function buildTranslateRequest(lines: string[]) {
  return {
    max_tokens: 6000, temperature: 0,
    system: "You translate web page text into English, faithfully and completely. Each input line is numbered: N<TAB>text. Answer with the same numbers, one line per input line, in the form N<TAB>English text. Never merge, split, skip or reorder lines. Keep every name, number, date, address and title exactly as written. Do not summarise or add anything. A line that is already English or has nothing to translate is repeated as it is.",
    messages: [{ role: "user" as const, content: lines.map((l, i) => `${i + 1}\t${l}`).join("\n") }],
  };
}

export interface TranslationPair { original: string; english: string }

/** The model's numbered answer, read back against the lines it was given. */
export function parseNumberedTranslation(answer: string, lines: string[]): TranslationPair[] {
  const byNo = new Map<number, string>();
  for (const l of answer.split("\n")) {
    const m = l.match(/^\s*(\d+)\t(.*)$/);
    if (m) byNo.set(Number(m[1]), m[2].trim());
  }
  const out: TranslationPair[] = [];
  lines.forEach((original, i) => { const english = byNo.get(i + 1); if (english) out.push({ original, english }); });
  return out;
}

/** The page cut into the lines that are translated one by one (so a quote can be taken back to its original line). */
export function linesOfPage(text: string, maxChars = 6000): string[] {
  const out: string[] = []; let n = 0;
  for (const raw of text.split(/\n+/)) {
    const l = raw.trim();
    if (!l) continue;
    if (n + l.length > maxChars) break;
    out.push(l); n += l.length;
  }
  return out;
}

export async function translateToEnglish(client: Anthropic, model: string, text: string, maxChars = 6000): Promise<TranslationPair[] | null> {
  const lines = linesOfPage(text, maxChars);
  if (!lines.length) return null;
  const msg = await client.messages.create(requestFor(buildTranslateRequest(lines), model));
  const block = msg.content.find((b) => b.type === "text");
  const pairs = block && block.type === "text" ? parseNumberedTranslation(block.text, lines) : [];
  // An answer that kept fewer than half of the lines is not an aligned translation.
  return pairs.length >= Math.max(1, Math.floor(lines.length / 2)) && pairs.map((p) => p.english).join(" ").length >= 40 ? pairs : null;
}

export interface Translatable { url: string; content: string; prompt_content?: string; translation_offset?: number; translation_pairs?: TranslationPair[] }

/**
 * Appends the English translation to up to `max` non-English items (the pages of the company's own site first, in the order given). Returns how many were translated.
 * The original line of every translated line is kept with the item (translation_pairs), so a quote found in the translation can be written beside the page's own words.
 * A failure of the model call leaves the item as it was.
 */
export async function translateItems<T extends Translatable>(items: T[], client: Anthropic, model: string, max = Number(process.env.TRANSLATE_MAX ?? 8), log: (m: string) => void = () => {}): Promise<number> {
  let done = 0;
  for (const it of items) {
    if (done >= max) break;
    if (it.translation_offset != null || looksEnglish(it.content)) continue;
    try {
      const pairs = await translateToEnglish(client, model, it.prompt_content ?? it.content);
      if (!pairs) continue;
      const tr = pairs.map((p) => p.english).join("\n");
      it.translation_offset = it.content.length + TRANSLATION_MARK.length;
      it.translation_pairs = pairs;
      it.content = `${it.content}${TRANSLATION_MARK}${tr}`;
      if (it.prompt_content) it.prompt_content = `${it.prompt_content}${TRANSLATION_MARK}${tr}`;
      done++;
      log(`    🌐  Translated to English for verification: ${it.url} (${pairs.length} line(s), ${tr.length} chars)`);
    } catch (e) { log(`    ⚠️  translation failed for ${it.url}: ${(e as Error).message}`); }
  }
  return done;
}

/** A quote that stands only in the translated half is marked, so the owner sees it is a machine translation. */
export function markTranslatedQuote(quote: string, source: { content: string; translation_offset?: number } | undefined): string {
  if (!source || source.translation_offset == null || !quote) return quote;
  const at = source.content.indexOf(quote);
  return at >= source.translation_offset ? `[machine translation] ${quote}` : quote;
}

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
/**
 * The two quotes of a value (owner, round 10): `original` is the page's own words, word for word, `translated` the English it was verified against (null when the page was English).
 * A quote found in the translated half is taken back to the original line(s) it was translated from.
 */
export function quotePair(quote: string, source: { content: string; translation_offset?: number; translation_pairs?: TranslationPair[] } | undefined): { original: string; translated: string | null } {
  const q = quote.replace(/^\[machine translation\]\s*/, "");
  if (!source || source.translation_offset == null || !q) return { original: q, translated: null };
  const at = source.content.indexOf(q);
  if (at >= 0 && at < source.translation_offset) return { original: q, translated: null };     // the quote is the page's own text
  const nq = norm(q);
  const pairs = source.translation_pairs ?? [];
  const hit = pairs.filter((p) => nq.includes(norm(p.english)) || norm(p.english).includes(nq));
  if (hit.length) return { original: hit.map((p) => p.original).join(" … "), translated: q };
  return { original: "", translated: q };   // no aligned original: the translation alone, said so
}
