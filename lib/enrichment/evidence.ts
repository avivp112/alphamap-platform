/**
 * lib/enrichment/evidence.ts — verifyEvidence(), per docs/enrichment_v2_spec.md
 * issue 1, point 4. Runs after extraction, before any value is accepted for
 * validation/write: every material field (city, country, founded_year,
 * employee_count, website, round amounts/valuations/dates/lead investors,
 * founder/leadership LinkedIn URLs, github_url, huggingface_url, ARR
 * milestones, valuation benchmarks) must cite a source_id and an
 * evidence_quote copied verbatim (per the extraction prompt rule) from that
 * source — this is what actually enforces "verbatim", catching a quote the
 * model paraphrased, invented, or pulled from the wrong source entirely.
 */

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’"“”]/g, "")
    // Hyphens are treated as word separators, not preserved — sources and
    // model-written quotes render the same compound ("co-led" / "co led",
    // "9-month" / "9 month") inconsistently, and this match is about
    // content, not exact hyphenation.
    .replace(/-/g, " ")
    .replace(/[^\p{L}\p{N}\s.$%]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordBigrams(words: string[]): Set<string> {
  if (words.length < 2) return new Set(words);
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) bigrams.add(`${words[i]} ${words[i + 1]}`);
  return bigrams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const x of a) if (b.has(x)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

export interface QuoteMatch {
  matched: boolean;
  similarity: number;
}

/**
 * Exact substring match (after normalizing whitespace/case/punctuation)
 * scores 1.0. Otherwise, a sliding-window word-bigram Dice coefficient
 * finds the best-matching span of the source of about the quote's own
 * length — catches a quote that's verbatim MODULO minor reformatting
 * (e.g. the model re-wrapped whitespace) without accepting a paraphrase.
 * matched = true at similarity >= 0.9, per issue 1.
 */
export function quoteMatchesSource(quote: string, sourceContent: string): QuoteMatch {
  const normQuote = normalizeForMatch(quote);
  const normSource = normalizeForMatch(sourceContent);
  if (!normQuote) return { matched: false, similarity: 0 };
  if (normSource.includes(normQuote)) return { matched: true, similarity: 1 };

  const quoteWords = normQuote.split(" ").filter(Boolean);
  const sourceWords = normSource.split(" ").filter(Boolean);
  if (quoteWords.length === 0 || sourceWords.length === 0) return { matched: false, similarity: 0 };

  const quoteBigrams = wordBigrams(quoteWords);
  const windowSize = Math.min(quoteWords.length, sourceWords.length);
  let best = 0;
  for (let start = 0; start <= sourceWords.length - windowSize; start++) {
    const window = sourceWords.slice(start, start + windowSize);
    const score = diceCoefficient(quoteBigrams, wordBigrams(window));
    if (score > best) best = score;
    if (best === 1) break;
  }
  return { matched: best >= 0.9, similarity: best };
}

const SCALE_WORDS: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mn: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
};

/** Finds every "$16 million" / "$16M" / "16,000,000" / "200000" style figure in free text, scaled to a plain number. */
export function extractNumbersFromText(text: string): number[] {
  const results: number[] = [];
  const regex = /\$?\s?(\d[\d,]*\.?\d*)\s*(thousand|million|billion|mn|bn|k|m|b)?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].replace(/,/g, "");
    const num = parseFloat(raw);
    if (Number.isNaN(num)) continue;
    const scaleWord = match[2]?.toLowerCase();
    const scale = scaleWord ? (SCALE_WORDS[scaleWord] ?? 1) : 1;
    results.push(num * scale);
  }
  return results;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Dates are parsed explicitly (never via Date.parse, which reads
// "October 15, 2024" in the machine's LOCAL timezone — compared as UTC that
// shifted the day by one on any server east of UTC, silently dropping
// correct dates). Recognized: "October 15, 2024", "Oct. 15 2024",
// "15 Oct 2024", "2024-10-15" (also with a time), "10/15/2024" or
// "15/10/2024", plus month-only ("October 2024") and year-only phrases for
// the extraction schema's own partial-date convention (YYYY-MM-01 = month
// known, YYYY-01-01 = year known).
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_TOKEN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const monthIndex = (token: string) => MONTH_NAMES.indexOf(token.slice(0, 3).toLowerCase()) + 1;

interface DateMention { y: number; m: number; d: number | null }

function dateMentions(text: string): DateMention[] {
  const out: DateMention[] = [];
  const t = text.toLowerCase();
  const add = (y: number, m: number, d: number | null) => {
    if (m >= 1 && m <= 12 && (d == null || (d >= 1 && d <= 31))) out.push({ y, m, d });
  };
  for (const x of t.matchAll(new RegExp(`\\b${MONTH_TOKEN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "g"))) add(+x[3], monthIndex(x[1]), +x[2]);
  for (const x of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_TOKEN},?\\s+(\\d{4})\\b`, "g"))) add(+x[3], monthIndex(x[2]), +x[1]);
  for (const x of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})/g)) add(+x[1], +x[2], +x[3]);
  for (const x of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) { add(+x[3], +x[1], +x[2]); add(+x[3], +x[2], +x[1]); }
  for (const x of t.matchAll(new RegExp(`\\b${MONTH_TOKEN},?\\s+(\\d{4})\\b`, "g"))) add(+x[2], monthIndex(x[1]), null);
  return out;
}

/** The first full calendar date (day known) written in `text`, as YYYY-MM-DD, or null. */
export function parseFullDate(text: string): string | null {
  const x = dateMentions(text).find((mention) => mention.d != null);
  return x ? `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}` : null;
}

/**
 * True when `quote` supports the ISO `isoDate` value: the same calendar
 * day in any recognized format; for a YYYY-MM-01 value, also that month
 * ("October 2024"); for a YYYY-01-01 value, also that year.
 */
function dateAppearsInQuote(isoDate: string, quote: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return false;
  const mentions = dateMentions(quote);
  if (mentions.some((x) => x.y === y && x.m === m && x.d === d)) return true;
  if (d === 1 && mentions.some((x) => x.y === y && x.m === m && x.d == null)) return true;
  if (m === 1 && d === 1 && new RegExp(`(^|[^\\d])${y}([^\\d]|$)`).test(quote)) return true;
  return false;
}

/**
 * True when `value` is actually present inside `quote` — not just "a number
 * is present somewhere", but THIS number (or this city/name/URL/date text).
 * A numeric value matches either by direct string containment (years, small
 * plain integers written the same way in prose) or by parsing money-scaled
 * figures ("$16 million" vs. the model's 16000000) and comparing with a
 * tight tolerance — never a loose "close enough" that would let a wrong
 * figure slip through as "basically right". A YYYY-MM-DD string value also
 * matches a same-calendar-day phrase in whatever natural format the source
 * used ("dated April 1 2026") — dates are a material field (issue 1) and a
 * source essentially never writes one in ISO form.
 */
export function valueAppearsInQuote(value: string | number, quote: string): boolean {
  if (typeof value === "number") {
    if (quote.includes(String(value))) return true;
    const candidates = extractNumbersFromText(quote);
    return candidates.some((n) => Math.abs(n - value) < 0.01 || (value !== 0 && Math.abs(n - value) / Math.abs(value) < 0.001));
  }
  if (ISO_DATE_RE.test(value) && dateAppearsInQuote(value, quote)) return true;
  const normValue = normalizeForMatch(value);
  if (!normValue) return false;
  return normalizeForMatch(quote).includes(normValue);
}

export type EvidenceDropReason = "source_not_found" | "evidence_mismatch" | "value_not_in_quote" | "url_not_in_source";

export interface EvidenceClaim {
  field: string;
  value: string | number;
  source_id: string;
  evidence_quote: string;
  /** True when `value` is itself a URL — checked verbatim against the source's full content, not just the quote. */
  is_url?: boolean;
}

export interface EvidenceSource {
  content: string;
  url: string;
}

export interface VerifyEvidenceResult {
  verified: boolean;
  drop_reason?: EvidenceDropReason;
  similarity?: number;
}

/**
 * The single gate every material field must pass before validation.ts or
 * write.ts ever sees it. Three independent checks, all required:
 *   1. The cited source_id actually exists in this run's source list.
 *   2. evidence_quote is genuinely found in that source's content (exact or
 *      fuzzy >= 0.9) — catches an invented or misattributed quote.
 *   3. The claimed value itself is actually inside that quote (or, for a
 *      URL value, verbatim in the source's full content) — catches a quote
 *      that's real but doesn't actually support the specific value claimed.
 */
export function verifyEvidence(
  claim: EvidenceClaim,
  sources: Record<string, EvidenceSource>,
): VerifyEvidenceResult {
  const source = sources[claim.source_id];
  if (!source) return { verified: false, drop_reason: "source_not_found" };

  // A real DRY_RUN=false run crashed here ("Cannot read properties of
  // undefined (reading 'toLowerCase')"): the extraction schema marks
  // evidence_quote (and value) "required" on every material field, but
  // exactly like the round_type enum before it, that's a strong hint, not a
  // hard constraint -- the model can still omit one. normalizeForMatch()/
  // valueAppearsInQuote() assume a real string and would throw rather than
  // just fail verification, so both are checked defensively before either
  // ever runs, instead of trusting the schema's "required" to hold.
  if (typeof claim.evidence_quote !== "string" || !claim.evidence_quote.trim()) {
    return { verified: false, drop_reason: "evidence_mismatch" };
  }

  const { matched, similarity } = quoteMatchesSource(claim.evidence_quote, source.content);
  if (!matched) return { verified: false, drop_reason: "evidence_mismatch", similarity };

  if (claim.is_url) {
    const url = String(claim.value ?? "").trim();
    if (!url || !source.content.includes(url)) {
      return { verified: false, drop_reason: "url_not_in_source", similarity };
    }
    return { verified: true, similarity };
  }

  if (claim.value == null || !valueAppearsInQuote(claim.value, claim.evidence_quote)) {
    return { verified: false, drop_reason: "value_not_in_quote", similarity };
  }

  return { verified: true, similarity };
}
