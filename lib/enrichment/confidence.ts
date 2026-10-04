/**
 * lib/enrichment/confidence.ts — computeFieldConfidence(), per
 * docs/enrichment_v2_spec.md issue 9.
 *
 * Replaces v1's single model-reported confidence_score (one number for the
 * WHOLE company, self-assessed by the model, gating only dollar figures)
 * with a confidence computed in code, per FIELD, from what actually backs
 * it. The model's own confidence_score/reasoning are kept in logs only —
 * nothing here reads them.
 */

import type { SourceType } from "./sourceTypes";

export interface ConfidenceThresholds {
  minProfileConfidence: number;
  minFundingConfidence: number;
}

// Matches the spec's own defaults: MIN_PROFILE_CONFIDENCE=50,
// MIN_FUNDING_CONFIDENCE=60.
export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  minProfileConfidence: 50,
  minFundingConfidence: 60,
};

export interface EvidenceForField {
  source_type: SourceType;
}

/**
 * Starting values from issue 9's table — explicitly called out there as
 * "to be tuned against the eval set", not fixed forever. Evaluated as an
 * ordered set of rules (highest-trust evidence wins) rather than a simple
 * lookup, since a field can be backed by several pieces of evidence of
 * different types at once and the table itself has one rule that depends on
 * COUNT, not just type ("2+ independent news sources agreeing" outranks a
 * single news source, at the same level as company_site/press_release).
 */
export function computeFieldConfidence(evidenceList: EvidenceForField[]): number {
  if (evidenceList.length === 0) return 0;

  if (evidenceList.some((e) => e.source_type === "registry")) return 90;
  if (evidenceList.some((e) => e.source_type === "company_site" || e.source_type === "press_release")) return 75;

  const newsCount = evidenceList.filter((e) => e.source_type === "news").length;
  if (newsCount >= 2) return 75;
  if (newsCount === 1) return 55;

  if (evidenceList.some((e) => e.source_type === "aggregator_snippet")) return 40;

  // model_inferred only (or nothing recognized) — no real evidence behind it.
  return 0;
}

export function meetsProfileThreshold(confidence: number, thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS): boolean {
  return confidence >= thresholds.minProfileConfidence;
}

export function meetsFundingThreshold(confidence: number, thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS): boolean {
  return confidence >= thresholds.minFundingConfidence;
}
