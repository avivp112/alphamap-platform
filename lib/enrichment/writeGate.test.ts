import { describe, it, expect } from "vitest";
import { enrichmentWriteRefusal, PHASE1_PASSED } from "./writeGate";

describe("no enrichment run writes before Phase 1 passes (owner, 2026-10-26)", () => {
  it("is closed now", () => {
    expect(PHASE1_PASSED).toBe(false);
  });

  it("refuses the run that wrote BETA's Dealroom-only $169M debt round — DRY_RUN=false", () => {
    expect(enrichmentWriteRefusal("bulk_enrich_v2", true, false)).toMatch(/writing is off until enrichment v2 passes Phase 1/);
  });

  it("lets a dry run and the golden-set evaluation through", () => {
    expect(enrichmentWriteRefusal("bulk_enrich_v2", false, false)).toBeNull();
  });

  it("opens only once the owner marks Phase 1 passed", () => {
    expect(enrichmentWriteRefusal("bulk_enrich_v2", true, true)).toBeNull();
  });
});
