import { describe, it, expect } from "vitest";
import { drawPilotSample, isThin, isIsraeli, type PilotCandidate } from "./pilotSample";
import { enrichmentWriteRefusal, PILOT_FIELDS } from "./writeGate";

const co = (i: number, over: Partial<PilotCandidate> = {}): PilotCandidate => ({ id: `c${i}`, name: `Co ${i}`, website: `co${i}.com`, description: "x", city: "Berlin", country: "Germany", founded_year: 2020, founding_country: null, ...over });

describe("the partial wet run (owner, 2026-11-01)", () => {
  it("draws 20 at random with at least 5 thin and 5 Israeli, each with a website; the same seed, the same draw", () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => co(i)),
      ...Array.from({ length: 8 }, (_, i) => co(100 + i, { country: "Israel", city: "Tel Aviv" })),
      ...Array.from({ length: 8 }, (_, i) => co(200 + i, { description: null, city: null, founded_year: null })),
      co(300, { website: null, country: "Israel" }),
    ];
    const s = drawPilotSample(rows, { size: 20, minThin: 5, minIsraeli: 5, seed: 42 });
    expect(s).toHaveLength(20);
    expect(s.filter(isThin).length).toBeGreaterThanOrEqual(5);
    expect(s.filter(isIsraeli).length).toBeGreaterThanOrEqual(5);
    expect(s.some((x) => x.id === "c300")).toBe(false);
    expect(drawPilotSample(rows, { size: 20, minThin: 5, minIsraeli: 5, seed: 42 }).map((x) => x.id)).toEqual(s.map((x) => x.id));
  });
  it("the gate lets a pilot write only its four fields, for a listed set of at most 25 companies", () => {
    expect(enrichmentWriteRefusal("bulk", true, false, { fields: PILOT_FIELDS, companies: 20 })).toBeNull();
    expect(enrichmentWriteRefusal("bulk", true, false, { fields: [...PILOT_FIELDS, "tech_stack"], companies: 20 })).toMatch(/tech_stack/);
    expect(enrichmentWriteRefusal("bulk", true, false, { fields: PILOT_FIELDS, companies: 0 })).toMatch(/ONLY/);
    expect(enrichmentWriteRefusal("bulk", true, false, { fields: PILOT_FIELDS, companies: 400 })).toMatch(/1–25/);
    expect(enrichmentWriteRefusal("bulk", true, false)).toMatch(/Phase 1/);
  });
});
