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

/**
 * True when `value` is actually present inside `quote` — not just "a number
 * is present somewhere", but THIS number (or this city/name/URL text). A
 * numeric value matches either by direct string containment (years, small
 * plain integers written the same way in prose) or by parsing money-scaled
 * figures ("$16 million" vs. the model's 16000000) and comparing with a
 * tight tolerance — never a loose "close enough" that would let a wrong
 * figure slip through as "basically right".
 */
export function valueAppearsInQuote(value: string | number, quote: string): boolean {
  if (typeof value === "number") {
    if (quote.includes(String(value))) return true;
    const candidates = extractNumbersFromText(quote);
    return candidates.some((n) => Math.abs(n - value) < 0.01 || (value !== 0 && Math.abs(n - value) / Math.abs(value) < 0.001));
  }
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

  const { matched, similarity } = quoteMatchesSource(claim.evidence_quote, source.content);
  if (!matched) return { verified: false, drop_reason: "evidence_mismatch", similarity };

  if (claim.is_url) {
    const url = String(claim.value).trim();
    if (!source.content.includes(url)) {
      return { verified: false, drop_reason: "url_not_in_source", similarity };
    }
    return { verified: true, similarity };
  }

  if (!valueAppearsInQuote(claim.value, claim.evidence_quote)) {
    return { verified: false, drop_reason: "value_not_in_quote", similarity };
  }

  return { verified: true, similarity };
}
