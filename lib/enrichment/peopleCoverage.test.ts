import { describe, it, expect } from "vitest";
import { coverage, withRunValues, type CompanyPeople } from "./peopleCoverage";

const c = (id: string, over: Partial<CompanyPeople> = {}): CompanyPeople => ({ id, name: id, founders: [], leadership: [], ...over });
describe("people coverage (owner, 2026-11-10)", () => {
  it("counts founders, a CEO, a biography and a background; the board is no leader", () => {
    const cos = [
      c("a", { founders: [{ name: "A One", bio: "Wrote it.", background: [{}] }], leadership: [{ name: "B Two", role: "CEO" }] }),
      c("b", { leadership: [{ name: "C Three", role: "Chief Executive Officer", group: "board" }] }),
      c("c"),
    ];
    expect(coverage(cos)).toEqual({ n: 3, founder: 1, ceo: 1, bio: 1, background: 1 });
  });
  it("a run's values are added to what is on file", () => {
    const after = withRunValues([c("a"), c("b")], [
      { company_id: "a", field: "founder", value: "A One — Co-Founder & CEO" },
      { company_id: "a", field: "founder_bio", value: "A One: Built systems for fifteen years." },
      { company_id: "b", field: "leader", value: "B Two — CEO · bio" },
    ]);
    expect(coverage(after)).toEqual({ n: 2, founder: 1, ceo: 2, bio: 1, background: 0 });
  });
});
