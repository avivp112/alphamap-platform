import { describe, it, expect } from "vitest";
import { rejudgeSectorMarks, sameSector } from "./sectorRejudge";

const m = (id: string, company: string, value: string) => ({ id, field: "sector", company, value });
describe("sector marks counted against the current classification", () => {
  it("a mark stays when the same sector comes out, and leaves when another does", async () => {
    const desc: Record<string, string> = { Verbit: "voice AI", Hofy: "device management" };
    const now: Record<string, string> = { Verbit: "AI & ML › Voice & Speech AI", Hofy: "Enterprise Software › Productivity & Collaboration" };
    const r = await rejudgeSectorMarks(
      [m("8.25", "Verbit", "AI & ML › Computer Vision"), m("8.x", "Verbit", "AI & ML › Voice & Speech AI"), m("8.y", "Hofy", "Enterprise Software › Productivity & Collaboration"), m("8.z", "NoText", "Fintech › Payments")],
      (c) => desc[c] ?? null, async (c) => now[c] ?? null);
    expect(r).toEqual([
      { id: "8.25", produced: false, now: "AI & ML › Voice & Speech AI" },
      { id: "8.x", produced: true, now: "AI & ML › Voice & Speech AI" },
      { id: "8.y", produced: true, now: "Enterprise Software › Productivity & Collaboration" },
    ]);
  });
  it("the company is classified once, however many marks it has; other fields are ignored", async () => {
    let calls = 0;
    await rejudgeSectorMarks([m("a", "X", "Fintech › Payments"), m("b", "X", "Fintech › Lending"), { id: "c", field: "tags", company: "X", value: "t" }], () => "d", async () => { calls++; return "Fintech › Payments"; });
    expect(calls).toBe(1);
  });
  it("a mark naming only the parent is judged on the parent", () => {
    expect(sameSector("Fintech", "Fintech › Payments")).toBe(true);
    expect(sameSector("Fintech › Lending", "Fintech › Payments")).toBe(false);
    expect(sameSector("Fintech › Payments", "Cybersecurity › Email Security")).toBe(false);
  });
});

import { applySectorRejudge } from "./sectorRejudge";
describe("the replay takes the classification's judgement", () => {
  it("a mark the rules keep leaves when the classification gives another sector; a rule's rejection stays", () => {
    const judged = new Map([["a", { produced: true }], ["b", { produced: false, rule: "a sector with no source" }], ["c", { produced: true }]]);
    applySectorRejudge(judged, [{ id: "a", produced: false, now: "AI & ML › Voice & Speech AI" }, { id: "b", produced: false, now: "x" }, { id: "c", produced: true, now: "y" }]);
    expect(judged.get("a")).toEqual({ produced: false, rule: "the current classification gives AI & ML › Voice & Speech AI" });
    expect(judged.get("b")?.rule).toBe("a sector with no source");
    expect(judged.get("c")).toEqual({ produced: true });
  });
});
