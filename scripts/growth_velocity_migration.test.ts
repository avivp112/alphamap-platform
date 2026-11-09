import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// 20261119 is 20260827's calculate_alphamap_score with exactly two lines added (the two headcount_history reads skip
// 'legacy' and 'model_estimate' points, owner 2026-11-09). Anything else drifting between them is a mistake.
const fnOf = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8").split("\n");
describe("Growth Velocity ignores legacy points", () => {
  it("differs from the 20260827 function by the two point_type lines only", () => {
    const before = fnOf("20260827000000_update_alphamap_score_formula.sql");
    const after = fnOf("20261119000000_growth_velocity_excludes_legacy.sql");
    const fn = (ls: string[]) => ls.slice(ls.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION calculate_alphamap_score")));
    const b = fn(before), a = fn(after);
    const added = a.filter((l) => !b.includes(l));
    expect(added.map((l) => l.trim())).toEqual(["AND point_type NOT IN ('legacy', 'model_estimate')", "AND point_type NOT IN ('legacy', 'model_estimate')"]);
    expect(b.filter((l) => !a.includes(l))).toEqual([]);
    expect(a.length - b.length).toBe(2);
  });
});
