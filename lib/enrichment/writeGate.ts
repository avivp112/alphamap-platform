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

import { WRITABLE_FIELDS } from "./writeUnits";

export const PHASE1_PASSED = false;

/**
 * The first partial wet run (owner, 2026-11-01): only the fields that passed
 * their bar — the declared headquarters, the founded year, the founding
 * country — for a hand-picked list of at most PILOT_MAX_COMPANIES companies
 * (scripts/pilot_sample.ts), after a DRY_RUN report the owner approved.
 */
// Owner, 2026-11-05: the pilot writes any review field the tracker has opened, and only those
// (writeUnits.ts) — the tracker is the gate, not a fixed list. News was the first to open.
export const PILOT_FIELDS: readonly string[] = WRITABLE_FIELDS;
export const PILOT_MAX_COMPANIES = 25;

export interface PilotRequest { fields: readonly string[]; companies: number }

/** Why a writing run is refused, or null when it may go ahead. */
export function enrichmentWriteRefusal(script: string, writes: boolean, phase1Passed = PHASE1_PASSED, pilot?: PilotRequest): string | null {
  if (!writes || phase1Passed) return null;
  if (pilot) {
    const outside = pilot.fields.filter((f) => !(PILOT_FIELDS as readonly string[]).includes(f));
    if (outside.length) return `${script}: the pilot may write only ${PILOT_FIELDS.join(", ")} — not ${outside.join(", ")}.`;
    if (pilot.companies < 1 || pilot.companies > PILOT_MAX_COMPANIES) return `${script}: a pilot writes a listed set of 1–${PILOT_MAX_COMPANIES} companies (ONLY=<ids>); got ${pilot.companies}.`;
    return null;
  }
  return `${script}: writing is off until enrichment v2 passes Phase 1 (lib/enrichment/writeGate.ts). ` +
    "Run it with DRY_RUN (the default) to see what it would write, or run the golden-set evaluation: PIPELINE=v2 npx tsx eval/run_eval.ts";
}

/** Stops a script that would write before it does anything. */
export function assertEnrichmentWritesAllowed(script: string, writes: boolean, pilot?: PilotRequest): void {
  const refusal = enrichmentWriteRefusal(script, writes, PHASE1_PASSED, pilot);
  if (!refusal) return;
  console.error(`⛔  ${refusal}`);
  process.exit(1);
}
