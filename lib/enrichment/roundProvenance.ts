/**
 * lib/enrichment/roundProvenance.ts — the evidence behind a round's written
 * values (Phase 1: "every accepted material value has a field_provenance row
 * with URL and verified quote"; issue 1 lists a round's amount, valuation,
 * date and lead investor as material).
 *
 * A round reaches the write stage after dedup and planning (rounds.ts,
 * assemble.ts planRoundWrites), which merge rounds field by field and keep
 * no evidence. So the evidence is found again here, by value: each written
 * value is matched to an extracted round (already verified by
 * extractFunding's verifyEvidence) that carries that same value — preferring
 * one that also agrees on the round's other values. No match, no row: never
 * an invented source.
 */
import type { V2Round } from "./extractFunding.ts";
import type { RoundLike } from "./rounds.ts";
import { normalizeForMatch } from "./evidence.ts";
import { normalizeIsoDate } from "./assemble.ts";

export const ROUND_MATERIAL_FIELDS = ["amount_raised", "valuation", "announcement_date", "lead_investor"] as const;
export type RoundMaterialField = (typeof ROUND_MATERIAL_FIELDS)[number];

export interface RoundFieldEvidence {
  field: RoundMaterialField;
  value: number | string;
  source_id: string;
  evidence_quote: string;
}

function same(field: RoundMaterialField, a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  if (field === "announcement_date") return (normalizeIsoDate(String(a)) ?? String(a)) === (normalizeIsoDate(String(b)) ?? String(b));
  if (field === "lead_investor") return normalizeForMatch(String(a)) === normalizeForMatch(String(b));
  return Number(a) === Number(b);
}

/** How many of `written`'s values this extracted round also carries — the tie-breaker. */
function agreement(written: Partial<RoundLike>, r: V2Round): number {
  return ROUND_MATERIAL_FIELDS.filter((f) => same(f, written[f], r[f]?.value)).length;
}

/**
 * Evidence for each material value in `written` (a new round, or the patch
 * that fills a round on file), from the rounds the extraction verified.
 */
export function roundFieldEvidence(written: Partial<RoundLike>, extracted: V2Round[]): RoundFieldEvidence[] {
  const out: RoundFieldEvidence[] = [];
  for (const field of ROUND_MATERIAL_FIELDS) {
    const value = written[field];
    if (value == null || value === "") continue;
    const best = extracted
      .filter((r) => r[field] && same(field, value, r[field]!.value) && r[field]!.source_id && r[field]!.evidence_quote)
      .sort((a, b) => agreement(written, b) - agreement(written, a))[0];
    if (best) out.push({ field, value: value as number | string, source_id: best[field]!.source_id, evidence_quote: best[field]!.evidence_quote });
  }
  return out;
}

/**
 * The patch that fills a round on file, cut to what has evidence (owner, 2026-11-09 — "no value written without a source"):
 * investor lists never fill; a material column no extracted round backs with a source and a quote is removed; with no
 * material column left the fill is null (nothing is written).
 */
export function evidencedFillPatch(patch: Record<string, unknown>, extracted: V2Round[]): Record<string, unknown> | null {
  const { investors: _i, investor_amounts: _a, ...rest } = patch;
  const backed = new Set(roundFieldEvidence(rest as Partial<RoundLike>, extracted).map((e) => e.field as string));
  const out: Record<string, unknown> = {};
  let material = 0;
  for (const [k, v] of Object.entries(rest)) {
    if ((ROUND_MATERIAL_FIELDS as readonly string[]).includes(k)) {
      if (v == null || v === "" || !backed.has(k)) continue;
      material++;
    }
    out[k] = v;
  }
  return material ? out : null;
}
