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

export function buildTranslateRequest(text: string) {
  return {
    max_tokens: 4000, temperature: 0,
    system: "You translate web page text into English, faithfully and completely. Keep every name, number, date, address and title exactly as written. Keep the line structure. Do not summarise, explain or add anything.",
    messages: [{ role: "user" as const, content: `Translate into English:\n\n${text}` }],
  };
}

export async function translateToEnglish(client: Anthropic, model: string, text: string, maxChars = 6000): Promise<string | null> {
  const msg = await client.messages.create(requestFor(buildTranslateRequest(text.slice(0, maxChars)), model));
  const block = msg.content.find((b) => b.type === "text");
  const out = block && block.type === "text" ? block.text.trim() : "";
  return out.length >= 40 ? out : null;
}

export interface Translatable { url: string; content: string; prompt_content?: string; translation_offset?: number }

/**
 * Appends the English translation to up to `max` non-English items (the pages of the company's own site first, in the order given). Returns how many were translated.
 * A failure of the model call leaves the item as it was.
 */
export async function translateItems<T extends Translatable>(items: T[], client: Anthropic, model: string, max = Number(process.env.TRANSLATE_MAX ?? 8), log: (m: string) => void = () => {}): Promise<number> {
  let done = 0;
  for (const it of items) {
    if (done >= max) break;
    if (it.translation_offset != null || looksEnglish(it.content)) continue;
    try {
      const tr = await translateToEnglish(client, model, it.prompt_content ?? it.content);
      if (!tr) continue;
      it.translation_offset = it.content.length + TRANSLATION_MARK.length;
      it.content = `${it.content}${TRANSLATION_MARK}${tr}`;
      if (it.prompt_content) it.prompt_content = `${it.prompt_content}${TRANSLATION_MARK}${tr}`;
      done++;
      log(`    🌐  Translated to English for verification: ${it.url} (${tr.length} chars)`);
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
