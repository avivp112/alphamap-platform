/**
 * lib/enrichment/descriptionBuilder.ts — v2's own company description (owner, 2026-11-08).
 * 2–4 sentences in a fixed shape, in English, from the sources only:
 *   1. what      what the company sells: the technology, the product itself
 *   2. for_whom  who buys it: the kind of customer and the field
 *   3. edge      optional, what sets it apart — only with a source that says so
 * Each sentence names the sources that support it. A sentence is dropped when a source it cites is not an allowed
 * one, when a number or a name in it is not in those sources, when it uses a marketing word, or when no sentence of
 * its sources comes near it. Without a "what" and a "for_whom" there is no description (missing is better than wrong).
 * The current website comes first in the prompt: it beats an old article. Pure: the model call is the caller's.
 */
import { articleDate } from "./headquarters.ts";
import { formatSourcesForPrompt, type LabeledSource } from "./sources.ts";
import { bestSentence } from "./quoteFinder.ts";

export type SentenceRole = "what" | "for_whom" | "edge";
export interface DescriptionSentence { role: SentenceRole; text: string; source_ids: string[]; quote: string }
export interface BuiltDescription { description: string; sentences: DescriptionSentence[]; dropped: Array<{ text: string; why: string }> }

/** Words that sell instead of describe. Used alone they say nothing; a sentence with one is rewritten or dropped. */
export const MARKETING = /\b(leading|leader in|innovative|innovation|revolutionary|revolutionize[sd]?|ai-native|cutting-edge|state-of-the-art|world-class|best-in-class|next-generation|next-gen|game-chang\w+|seamless(ly)?|unparalleled|disruptive|industry-leading|pioneering|transformative|powerful|robust|end-to-end|lowest|highest|best|fastest|first|largest|biggest|smallest|most|top|greatest|unmatched|unrivall?ed|premier|foremost|ultimate|market leader|number one|#1)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/[^\p{L}\p{N}$%.+ ]/gu, " ").replace(/\s+/g, " ");
const COMMON_CAPS = new Set(["the", "a", "an", "it", "its", "this", "that", "they", "their", "for", "to", "and", "in", "of", "with", "by", "on", "from", "ai", "api", "saas", "b2b", "b2c", "it", "ml", "sdk", "iot", "cloud", "ceo", "cto", "us", "usa", "eu", "uk"]);

/** The numbers and the capitalised names of a sentence (not its first word, not the company's own name). */
export function claims(sentence: string, companyName: string): { numbers: string[]; names: string[] } {
  const numbers = (sentence.match(/\$?\d[\d,.]*\s?(?:[kKmMbB]\b|%|\+)?/g) ?? []).map((n) => n.replace(/[$,\s+]/g, "").replace(/\.$/, "")).filter(Boolean);
  const own = new Set(norm(companyName).split(" "));
  const names: string[] = [];
  const words = sentence.split(/\s+/);
  words.forEach((w, i) => {
    const bare = w.replace(/^[("'“]+|[)"'”.,;:!?]+$/g, "");
    if (i === 0 || !/^[A-Z][\p{L}\d&-]{1,}$/u.test(bare)) return;
    const k = bare.toLowerCase();
    if (!COMMON_CAPS.has(k) && !own.has(k)) names.push(bare);
  });
  return { numbers, names: [...new Set(names)] };
}

export function sentenceProblem(
  s: { role: string; text: string; source_ids: string[] }, companyName: string,
  byId: Record<string, { content: string }>, allowed: (id: string) => boolean,
): string | null {
  if (!["what", "for_whom", "edge"].includes(s.role)) return "unknown_role";
  if (!s.text?.trim() || s.text.length > 400) return "bad_text";
  if (!s.source_ids?.length) return "no_source";
  for (const id of s.source_ids) {
    if (!byId[id]) return "source_not_found";
    if (!allowed(id)) return "source_not_allowed";
  }
  if (MARKETING.test(s.text)) return "marketing_word";
  const hay = norm(s.source_ids.map((id) => byId[id].content).join(" "));
  const c = claims(s.text, companyName);
  for (const n of c.numbers) if (!hay.includes(norm(n))) return `number_not_in_sources:${n}`;
  for (const n of c.names) if (!hay.includes(norm(n))) return `name_not_in_sources:${n}`;
  if (!s.source_ids.some((id) => bestSentence(byId[id].content, s.text, 3))) return "no_supporting_sentence";
  return null;
}

export function processDescription(
  input: unknown, companyName: string, byId: Record<string, { content: string }>, allowed: (id: string) => boolean,
): BuiltDescription | null {
  const list = Array.isArray((input as { sentences?: unknown })?.sentences) ? (input as { sentences: Array<{ role: string; text: string; source_ids: string[] }> }).sentences : [];
  const kept: DescriptionSentence[] = [];
  const dropped: BuiltDescription["dropped"] = [];
  for (const s of list) {
    const why = sentenceProblem(s, companyName, byId, allowed);
    if (why) { dropped.push({ text: s?.text ?? "", why }); continue; }
    if (kept.some((k) => k.role === s.role)) { dropped.push({ text: s.text, why: "second_sentence_of_role" }); continue; }
    const quote = s.source_ids.map((id) => bestSentence(byId[id].content, s.text, 3)).find(Boolean) ?? "";
    kept.push({ role: s.role as SentenceRole, text: s.text.trim(), source_ids: s.source_ids, quote });
  }
  const order: SentenceRole[] = ["what", "for_whom", "edge"];
  kept.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  if (!kept.some((k) => k.role === "what") || !kept.some((k) => k.role === "for_whom")) return null;
  return { description: kept.map((k) => k.text).join(" "), sentences: kept, dropped };
}

export function descriptionTool() {
  return {
    name: "save_description",
    description: "Save the company description as role-tagged sentences, each with the sources that support it.",
    input_schema: {
      type: "object" as const,
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["what", "for_whom", "edge"] },
              text: { type: "string" },
              source_ids: { type: "array", items: { type: "string" } },
            },
            required: ["role", "text", "source_ids"],
          },
        },
      },
      required: ["sentences"],
    },
  };
}

/** Sources for the prompt: the company's own pages first, then the allowed ones, capped. */
export const DESCRIPTION_MAX_AGE_DAYS = 2 * 365;
/** A dated article older than two years (owner, 2026-11-09, review 7: AYOXXA's description came from a 2015 release): not a source for what the company is now. The company's own pages are always current. */
export function tooOldForDescription(s: Pick<LabeledSource, "url" | "content" | "source_type">, today = new Date().toISOString().slice(0, 10)): boolean {
  if (s.source_type === "company_site") return false;
  const d = articleDate(s);
  return !!d && Date.parse(today) - Date.parse(d) > DESCRIPTION_MAX_AGE_DAYS * 86_400_000;
}

export function descriptionSources(all: LabeledSource[], allowed: (s: LabeledSource) => boolean, max = 14): LabeledSource[] {
  const ok = all.filter(allowed).filter((s) => !tooOldForDescription(s));
  return [...ok.filter((s) => s.source_type === "company_site"), ...ok.filter((s) => s.source_type !== "company_site")].slice(0, max);
}

export function buildDescriptionRequest(companyName: string, sources: LabeledSource[]) {
  const prompt = `Write the description of "${companyName}" from the research below, in English, as 2 to 4 sentences with a fixed shape.

SENTENCES (one per role, in this order):
1. role "what": what the company sells — its technology and the product itself.
2. role "for_whom": who it is sold to — the kind of customer and the field.
3. role "edge" (optional): what sets it apart. Include it only when a source says so; otherwise leave it out.

RULES:
- Facts only, each one stated in the sources you cite. Neutral tone, plain words. Do not use "leading", "innovative", "revolutionary", "AI-native", "cutting-edge", "world-class", "powerful", "seamless", or superlatives such as "lowest", "best", "fastest", "first", "largest", "most"; describe what the product does instead.
- Every sentence lists the source_ids that support it. A number or a name that is not in those sources must not appear.
- The company's own current website comes first; prefer it to an older article, and never describe it from an article older than two years. Describe the company as it is now.
- Do not mention funding, investors, rankings, data platforms or where a fact was read. Do not start with the company name more than once.
- If the sources do not support a "what" and a "for_whom" sentence, return no sentences.

Labeled research:
${formatSourcesForPrompt(sources)}`;
  return {
    model: "", max_tokens: 1500, temperature: 0,
    tools: [descriptionTool()], tool_choice: { type: "tool" as const, name: "save_description" },
    messages: [{ role: "user" as const, content: prompt }],
  };
}
