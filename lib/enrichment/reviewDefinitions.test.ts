import { describe, it, expect } from "vitest";
import { definitionLines, DEFINITIONS } from "./reviewDefinitions";
import { REVIEW_FIELDS } from "./reviewValues";

describe("what 'correct' means for the newer review fields", () => {
  it("every new field has a definition, and the report prints only the fields it knows", () => {
    for (const f of ["description", "sector", "tags", "employee_history", "competitor_market", "founder_background"]) expect(DEFINITIONS[f]).toBeTruthy();
    expect(definitionLines(REVIEW_FIELDS).length).toBe(Object.keys(DEFINITIONS).filter((f) => (REVIEW_FIELDS as readonly string[]).includes(f)).length);
    expect(definitionLines(["hq_city"])).toEqual([]);
  });
  it("the tags rule: one wrong tag makes the list wrong", () => { expect(DEFINITIONS.tags).toMatch(/whole list/); });
});
