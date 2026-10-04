/**
 * lib/enrichment/extractFunding.ts — extractFunding(), the second of the
 * two extraction calls (see extractProfile.ts for the first). Per
 * docs/enrichment_v2_spec.md issue 1 point 5 and stage 4: takes the
 * funding/investors/earliest-rounds/ARR-valuation search results (already
 * filtered by entity.ts) and produces rounds, funding_history_complete,
 * ARR milestones, revenue range, and valuation benchmarks.
 *
 * Same split as extractProfile.ts: pure, fully unit-tested
 * build/process functions, plus a thin untestable-without-credentials
 * live-API wrapper.
 */

import Anthropic from "@anthropic-ai/sdk";
import { sanitizeModelOutput, ensureArray } from "./sanitize";
import { verifyEvidence, type EvidenceSource } from "./evidence";
import { formatSourcesForPrompt, type LabeledSource } from "./sources";
import { normalizeRoundType, type RoundLike } from "./rounds";

export interface EvidencedValue<T> {
  value: T;
  source_id: string;
  evidence_quote: string;
}

export interface V2InvestorAmount { name: string; amount: number }

export interface V2Round {
  /** NOT material on its own per issue 1's list (only amount/valuation/date/lead_investor are) — a categorical label read off the same evidence as those. */
  round_type: string;
  amount_raised?: EvidencedValue<number>;
  valuation?: EvidencedValue<number>;
  is_valuation_estimated?: boolean;
  announcement_date?: EvidencedValue<string>;
  lead_investor?: EvidencedValue<string>;
  other_investors?: string[];
  investor_amounts?: V2InvestorAmount[];
  source_url?: string;
}

export interface V2ArrMilestone {
  arr: number;
  date?: string;
  source_id: string;
  evidence_quote: string;
}

export interface V2RevenueEstimate {
  range_low?: number;
  range_high?: number;
  as_of_date?: string;
  source_id?: string;
  evidence_quote?: string;
}

export interface V2ValuationBenchmark {
  valuation: number;
  date?: string;
  is_estimated?: boolean;
  source_id: string;
  evidence_quote: string;
}

export interface V2FundingExtraction {
  funding_rounds: V2Round[];
  funding_history_complete: boolean | null;
  arr_milestones: V2ArrMilestone[];
  revenue_estimate: V2RevenueEstimate | null;
  valuation_benchmarks: V2ValuationBenchmark[];
}

/** Flattens a verified V2Round down to the plain shape rounds.ts/validation.ts operate on — called by the orchestrator AFTER evidence verification has already dropped whatever didn't check out. */
export function roundToRoundLike(round: V2Round): RoundLike {
  return {
    // Normalized, not the raw model string: a real DRY_RUN run against
    // production data produced "Venture" and "Venture Debt" for round_type
    // despite the schema's enum listing only canonical values -- Claude's
    // tool_choice enum is a strong hint, not a hard constraint, so this
    // (like v1's own insertNewRounds()) must normalize defensively rather
    // than trust the raw string ever reaching rounds.ts's dedup or a DB
    // insert unnormalized.
    round_type: normalizeRoundType(round.round_type),
    amount_raised: round.amount_raised?.value ?? null,
    valuation: round.valuation?.value ?? null,
    announcement_date: round.announcement_date?.value ?? null,
    lead_investor: round.lead_investor?.value ?? null,
    other_investors: round.other_investors ?? null,
    source_url: round.source_url ?? null,
  };
}

// ── Schema construction ─────────────────────────────────────────────────

function materialField(valueSchema: Record<string, unknown>, description: string) {
  return {
    type: "object" as const,
    description,
    properties: {
      value: valueSchema,
      source_id: { type: "string", description: "The [Sx]/[Wx] id of the ONE source this value was taken from." },
      evidence_quote: { type: "string", description: "5-40 words copied VERBATIM from that source, containing this exact value. Never paraphrase." },
    },
    required: ["value", "source_id", "evidence_quote"],
  };
}

const ROUND_TYPE_ENUM = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D", "Series E", "Series F+",
  "Growth", "Venture Debt", "Grant", "Secondary",
  "Convertible Note", "Bootstrapped", "Acquired", "PE Buyout", "IPO", "Debt", "Other",
];

function fundingExtractionTool() {
  return {
    name: "save_funding_extraction",
    description: "Save the verified funding history, ARR, and valuation signals for a private tech company.",
    input_schema: {
      type: "object" as const,
      properties: {
        funding_rounds: {
          type: "array",
          description: "Every verified funding round, OLDEST to NEWEST. Return [] rather than guess — a company you cannot verify any round for genuinely has an empty array, which is the normal, correct answer, not a failure.",
          items: {
            type: "object" as const,
            properties: {
              round_type: { type: "string", enum: ROUND_TYPE_ENUM },
              amount_raised: materialField({ type: "number" }, "USD raised in THIS round as a plain integer ($50M -> 50000000). Omit the whole field if unknown — never guess a figure."),
              valuation: materialField({ type: "number" }, "Post-money valuation in USD as a plain integer. Omit if unconfirmed."),
              is_valuation_estimated: { type: "boolean", description: "true if the valuation was estimated/inferred rather than officially disclosed." },
              announcement_date: materialField({ type: "string" }, "YYYY-MM-DD, or YYYY-MM-01 if only the year+month is known, or YYYY-01-01 if only the year is known."),
              lead_investor: materialField({ type: "string" }, "Full name of the lead investor for THIS round. Omit if unknown — never guess from a later round's investor list."),
              other_investors: { type: "array", items: { type: "string" }, description: "All other participating investors. Omit if none known." },
              investor_amounts: {
                type: "array",
                description: "Only for an investor whose SPECIFIC dollar contribution to THIS round is explicitly disclosed. Rare. Never split the round total evenly across participants.",
                items: {
                  type: "object" as const,
                  properties: { name: { type: "string" }, amount: { type: "number" } },
                  required: ["name", "amount"],
                },
              },
              source_url: { type: "string", description: "Best URL for this specific round: press release, SEC filing, or a direct-reporting article." },
            },
            required: ["round_type"],
          },
        },
        funding_history_complete: {
          type: "boolean",
          description: [
            "FALSE if you have specific reason to believe funding_rounds is NOT the complete history (e.g. a Series B+ round",
            "confirmed with no earlier Seed/Series A despite the company clearly not being bootstrapped, or a source states an",
            "aggregate like '8 total funding rounds' you cannot fully itemize). Companies genuinely skip early rounds fairly",
            "often — the ABSENCE of an early round is not itself evidence of a gap. If you cannot verify an earlier round",
            "after actively checking every source below for a founding-era raise or a total-raised figure higher than what",
            "you can itemize, set this to false and leave funding_rounds as-is — do NOT invent an early round to fill the gap.",
            "Default TRUE if you have no specific reason to suspect a gap.",
          ].join(" "),
        },
        arr_milestones: {
          type: "array",
          description: "Dated ARR/revenue milestones explicitly reported, independent of any funding round. Most companies disclose none — [] is the normal, correct answer.",
          items: {
            type: "object" as const,
            properties: {
              arr: { type: "number" }, date: { type: "string" },
              source_id: { type: "string" }, evidence_quote: { type: "string" },
            },
            required: ["arr", "source_id", "evidence_quote"],
          },
        },
        revenue_estimate: {
          type: "object" as const,
          description: "A SINGLE current revenue range snapshot, not a history (use arr_milestones for that). Omit entirely if no source gives a range.",
          properties: {
            range_low: { type: "number" }, range_high: { type: "number" }, as_of_date: { type: "string" },
            source_id: { type: "string" }, evidence_quote: { type: "string" },
          },
        },
        valuation_benchmarks: {
          type: "array",
          description: "A valuation NOT already attached to a round in funding_rounds[] above — never duplicate a round's own valuation here.",
          items: {
            type: "object" as const,
            properties: {
              valuation: { type: "number" }, date: { type: "string" }, is_estimated: { type: "boolean" },
              source_id: { type: "string" }, evidence_quote: { type: "string" },
            },
            required: ["valuation", "source_id", "evidence_quote"],
          },
        },
      },
      required: ["funding_rounds", "funding_history_complete"],
    },
  };
}

export function buildFundingExtractionRequest(companyName: string, sources: LabeledSource[]) {
  const context = formatSourcesForPrompt(sources);
  const prompt = `You are a financial data analyst. Extract the COMPLETE verified funding history for the private tech company "${companyName}" from the labeled research below.

STRICT RULES:
1. ALL FUNDING ROUNDS — if the company raised Pre-Seed, Seed, Series A, and Series B, the array MUST have 4 items. Never collapse two distinct rounds into one, even if their amounts happen to be similar.
2. Every material field on a round (amount_raised, valuation, announcement_date, lead_investor) requires an evidence_quote copied VERBATIM (5-40 words) from its cited source, and the exact source_id ([S3], [W1], etc.) that quote came from. Omit the field entirely rather than guess.
3. DIG FOR EARLY ROUNDS — before concluding there's no earlier round, actively re-scan EVERY source below (not just ones about "earliest rounds") for a founding-era raise or a "total raised since founding" figure higher than what you can itemize. But: companies skip early rounds fairly often, and the absence of a Seed/Series A is not itself proof one exists un-found. If you still can't verify it, set funding_history_complete: false and leave funding_rounds as-is — never invent a round to fill a suspected gap.
4. LEAD INVESTOR — one lead per round in lead_investor; everyone else in other_investors. Never assume a later round's lead also led an earlier round.
5. VALUATION — set is_valuation_estimated: true if inferred/analyst-estimated rather than officially disclosed by the company or a primary source.
6. NEVER construct or guess a source_url — only a URL that appears verbatim in a source.
7. NON-VC EVENTS — 'PE Buyout' = a private-equity takeover/buyout/take-private. 'Acquired' = bought by a strategic operating company. 'Secondary' = existing shareholders selling, NO new money to the company — never report a secondary as capital raised. 'Debt' = venture debt/credit facilities/term loans, reported but never conflated with an equity round.
8. ARR/REVENUE/VALUATION — best-effort; most companies disclose none of this, and [] / omitted is the normal, correct answer, not a failure. Never duplicate a round's own valuation in valuation_benchmarks.

Labeled research (each source is tagged [S#] for a search result or [W#] for a fetched website page):
${context}`;

  return {
    model: "", // filled in by the caller with FUNDING_MODEL
    max_tokens: 8192,
    temperature: 0,
    tools: [fundingExtractionTool()],
    tool_choice: { type: "tool" as const, name: "save_funding_extraction" },
    messages: [{ role: "user" as const, content: prompt }],
  };
}

// ── Response processing (pure, testable without any live call) ──────────

export type DropReasonCode = "evidence_mismatch" | "value_not_in_quote" | "url_not_in_source" | "source_not_found";

export interface DroppedField { field: string; reason: DropReasonCode }

export interface ProcessedFundingExtraction {
  result: V2FundingExtraction;
  dropped: DroppedField[];
}

function verifyMaterial<T>(
  field: string,
  claim: EvidencedValue<T> | undefined,
  sources: Record<string, EvidenceSource>,
  dropped: DroppedField[],
): EvidencedValue<T> | undefined {
  if (!claim) return undefined;
  const verdict = verifyEvidence(
    { field, value: claim.value as unknown as string | number, source_id: claim.source_id, evidence_quote: claim.evidence_quote },
    sources,
  );
  if (!verdict.verified) {
    dropped.push({ field, reason: (verdict.drop_reason as DropReasonCode) ?? "evidence_mismatch" });
    return undefined;
  }
  return claim;
}

export function processFundingExtractionResponse(
  rawToolInput: unknown,
  sources: LabeledSource[],
): ProcessedFundingExtraction {
  const sourceLookup: Record<string, EvidenceSource> = Object.fromEntries(
    sources.map((s) => [s.source_id, { content: s.content, url: s.url }]),
  );
  const dropped: DroppedField[] = [];
  const i = sanitizeModelOutput(rawToolInput) as Partial<V2FundingExtraction> & {
    funding_rounds?: Array<Partial<V2Round> & { round_type?: string }>;
  };

  const rounds: V2Round[] = ensureArray<Partial<V2Round> & { round_type?: string }>(i.funding_rounds)
    .filter((r): r is Partial<V2Round> & { round_type: string } => !!r.round_type)
    .map((r, idx) => ({
      round_type: r.round_type,
      amount_raised: verifyMaterial(`funding_rounds[${idx}].amount_raised`, r.amount_raised, sourceLookup, dropped),
      valuation: verifyMaterial(`funding_rounds[${idx}].valuation`, r.valuation, sourceLookup, dropped),
      is_valuation_estimated: r.is_valuation_estimated,
      announcement_date: verifyMaterial(`funding_rounds[${idx}].announcement_date`, r.announcement_date, sourceLookup, dropped),
      lead_investor: verifyMaterial(`funding_rounds[${idx}].lead_investor`, r.lead_investor, sourceLookup, dropped),
      other_investors: r.other_investors,
      investor_amounts: r.investor_amounts,
      source_url: r.source_url,
    }));

  const arrMilestones = ensureArray<V2ArrMilestone>(i.arr_milestones).filter((m) => {
    const verdict = verifyEvidence({ field: "arr_milestones", value: m.arr, source_id: m.source_id, evidence_quote: m.evidence_quote }, sourceLookup);
    if (!verdict.verified) {
      dropped.push({ field: "arr_milestones", reason: (verdict.drop_reason as DropReasonCode) ?? "evidence_mismatch" });
      return false;
    }
    return true;
  });

  let revenueEstimate: V2RevenueEstimate | null = null;
  if (i.revenue_estimate && (i.revenue_estimate.range_low != null || i.revenue_estimate.range_high != null)) {
    const re = i.revenue_estimate;
    if (re.source_id && re.evidence_quote) {
      const checkValue = re.range_low ?? re.range_high ?? 0;
      const verdict = verifyEvidence({ field: "revenue_estimate", value: checkValue, source_id: re.source_id, evidence_quote: re.evidence_quote }, sourceLookup);
      if (verdict.verified) revenueEstimate = re;
      else dropped.push({ field: "revenue_estimate", reason: (verdict.drop_reason as DropReasonCode) ?? "evidence_mismatch" });
    } else {
      dropped.push({ field: "revenue_estimate", reason: "source_not_found" });
    }
  }

  const valuationBenchmarks = ensureArray<V2ValuationBenchmark>(i.valuation_benchmarks).filter((v) => {
    const verdict = verifyEvidence({ field: "valuation_benchmarks", value: v.valuation, source_id: v.source_id, evidence_quote: v.evidence_quote }, sourceLookup);
    if (!verdict.verified) {
      dropped.push({ field: "valuation_benchmarks", reason: (verdict.drop_reason as DropReasonCode) ?? "evidence_mismatch" });
      return false;
    }
    return true;
  });

  return {
    result: {
      funding_rounds: rounds,
      funding_history_complete: i.funding_history_complete ?? null,
      arr_milestones: arrMilestones,
      revenue_estimate: revenueEstimate,
      valuation_benchmarks: valuationBenchmarks,
    },
    dropped,
  };
}

// ── Live API wrapper (not unit-testable without credentials) ────────────

export interface ExtractFundingOptions {
  client: Anthropic;
  model: string;
}

export async function extractFunding(
  companyName: string,
  sources: LabeledSource[],
  options: ExtractFundingOptions,
): Promise<{ extraction: ProcessedFundingExtraction; stopReason: string | null; inputTokens: number; outputTokens: number } | null> {
  const request = buildFundingExtractionRequest(companyName, sources);
  const msg = await options.client.messages.create({ ...request, model: options.model });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") {
    return {
      extraction: { result: { funding_rounds: [], funding_history_complete: null, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] }, dropped: [] },
      stopReason: msg.stop_reason,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
    };
  }

  return {
    extraction: processFundingExtractionResponse(tool.input, sources),
    stopReason: msg.stop_reason,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}
