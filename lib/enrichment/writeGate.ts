/**
 * lib/enrichment/writeGate.ts — no enrichment run writes to the database
 * until enrichment v2 passes Phase 1 (owner, 2026-10-26).
 *
 * The 2026-10-26 run wrote other companies' patents (1AHEAD got Snap's AR
 * patent), partners as competitors (Twist Bioscience for Biotia), invented
 * round labels (Biotia's "$9M financing" as "Growth") and a $169M debt round
 * whose only source was app.dealroom.co (BETA). Until eval/run_eval.ts shows
 * every Phase 1 threshold passing on the golden set, a run may only look:
 * DRY_RUN, or the golden-set evaluation (which writes nothing to startups).
 *
 * PHASE1_PASSED is changed by hand, by the owner, after reading a passing
 * eval report — never by a script.
 */

export const PHASE1_PASSED = false;

/** Why a writing run is refused, or null when it may go ahead. */
export function enrichmentWriteRefusal(script: string, writes: boolean, phase1Passed = PHASE1_PASSED): string | null {
  if (!writes || phase1Passed) return null;
  return `${script}: writing is off until enrichment v2 passes Phase 1 (lib/enrichment/writeGate.ts). ` +
    "Run it with DRY_RUN (the default) to see what it would write, or run the golden-set evaluation: PIPELINE=v2 npx tsx eval/run_eval.ts";
}

/** Stops a script that would write before it does anything. */
export function assertEnrichmentWritesAllowed(script: string, writes: boolean): void {
  const refusal = enrichmentWriteRefusal(script, writes);
  if (!refusal) return;
  console.error(`⛔  ${refusal}`);
  process.exit(1);
}
