import { describe, it, expect } from "vitest";
import { mergeRuns } from "./mergeResults";

describe("a partial run laid over a full one", () => {
  const base = { generated_at: "t0", per_company: { wiz: { output: { founded_year: 2021 } }, mercury: { output: { city: "SF" } } } };
  const patch = { generated_at: "t1", per_company: { wiz: { output: { founded_year: null } }, newco: { output: {} } } };
  it("replaces the companies it holds, keeps the rest, and says which", () => {
    const r = mergeRuns(base, patch);
    expect(r.replaced).toEqual(["wiz"]);
    expect(r.added).toEqual(["newco"]);
    expect((r.merged.per_company as Record<string, unknown>).wiz).toEqual({ output: { founded_year: null } });
    expect((r.merged.per_company as Record<string, unknown>).mercury).toEqual({ output: { city: "SF" } });
  });
  it("does not change the base it was given", () => {
    mergeRuns(base, patch);
    expect((base.per_company.wiz.output as { founded_year: number }).founded_year).toBe(2021);
  });
});
