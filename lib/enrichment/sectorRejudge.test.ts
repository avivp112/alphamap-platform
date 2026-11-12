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

import { marksForNewClassifications } from "./sectorRejudge";
import { pendingSectorReviews, fieldStatus, type Mark } from "./fieldReview";

describe("a changed classifier needs a review of its new values before the field is open (owner, 2026-11-10)", () => {
  const old = (id: string, company: string, value: string, verdict: "correct" | "wrong" = "correct", source_url = "https://x.example/"): Mark => ({ id, field: "sector", company, value, source_url, verdict, source_of_mark: "" });
  const olds = [old("6.26", "Adranos", "DeepTech › DeepTech / General", "wrong", ""), old("x67.32", "Vulcan Cyber", "Cybersecurity › Cybersecurity / General"), old("8.25", "Verbit", "AI & ML › Computer Vision", "wrong"), old("x67.1", "Same Co", "Fintech › Payments")];
  const rows = [
    { id: "6.26", produced: false, now: "DeepTech › Space Tech" },
    { id: "x67.32", produced: false, now: "Cybersecurity › Vulnerability Management" },
    { id: "8.25", produced: false, now: "AI & ML › Voice & Speech AI" },
    { id: "x67.1", produced: true, now: "Fintech › Payments" },
  ];
  it("the new values are entered as marks of their own: wrong for the ids named, correct for the rest; the source is the description's", () => {
    const { marks, unknown } = marksForNewClassifications(rows, olds, ["8.25"], (c) => (c === "Adranos" ? "https://adranos.com/" : undefined), "owner 2026-11-10 (sector rejudge)");
    expect(unknown).toEqual([]);
    expect(marks.map((m) => [m.id, m.company, m.value, m.verdict])).toEqual([
      ["rj.6.26", "Adranos", "DeepTech › Space Tech", "correct"],
      ["rj.x67.32", "Vulcan Cyber", "Cybersecurity › Vulnerability Management", "correct"],
      ["rj.8.25", "Verbit", "AI & ML › Voice & Speech AI", "wrong"],
    ]);
    expect(marks[0].source_url).toBe("https://adranos.com/");
    expect(marksForNewClassifications(rows, olds, ["nope"], () => undefined, "n").unknown).toEqual(["nope"]);
  });
  it("a second round enters only the values still without a mark, with the round in the id", () => {
    const first = marksForNewClassifications(rows, olds, [], () => undefined, "n").marks;
    const after = [...olds, ...first];
    // The classifier changed again: Adranos's rj.6.26 mark (DeepTech › Space Tech) is no longer what it gives.
    const rows2 = [{ id: "rj.6.26", produced: false, now: "Industrial & Manufacturing › Advanced Manufacturing" }, { id: "rj.x67.32", produced: true, now: "Cybersecurity › Vulnerability Management" }];
    const second = marksForNewClassifications(rows2, after, ["rj.6.26"], () => undefined, "n2");
    expect(second.marks.map((m) => [m.id, m.company, m.verdict])).toEqual([["rj2.rj.6.26", "Adranos", "wrong"]]);
    expect(marksForNewClassifications(rows, after, [], () => undefined, "n3").marks).toEqual([]);
  });
  it("until each changed value has a mark the sector field is held; after, it is not", () => {
    expect(pendingSectorReviews(rows, olds)).toBe(3);
    const { marks } = marksForNewClassifications(rows, olds, [], () => undefined, "n");
    expect(pendingSectorReviews(rows, [...olds, ...marks])).toBe(0);
    expect(pendingSectorReviews(rows, [...olds, ...marks.slice(0, 2)])).toBe(1);
  });
  it("fieldStatus does not open a field that is waiting, however good its marks are", () => {
    const good: Mark[] = Array.from({ length: 25 }, (_, i) => old(`s.${i}`, `Co${i}`, "Fintech › Payments"));
    expect(fieldStatus(good, {}).find((s) => s.field === "sector")?.open).toBe(true);
    const held = fieldStatus(good, { sector: 3 }).find((s) => s.field === "sector");
    expect(held?.open).toBe(false);
    expect(held?.pending).toBe(3);
  });
});

describe("one value, one mark; one answer per classifier version (owner, 2026-11-12)", () => {
  const m = (id: string, company: string, value: string): Mark => ({ id, field: "sector", company, value, source_url: "https://x.example/", verdict: "wrong", source_of_mark: "" });
  it("two old marks of a company that change to the same value give one new mark, wrong if either is named", () => {
    const marks = [m("9.61", "Agnikul Cosmos", "Real Estate › PropTech"), m("rj.9.61", "Agnikul Cosmos", "Industrial & Manufacturing › Advanced Manufacturing")];
    const rows = [{ id: "9.61", produced: false, now: "DeepTech › Space Tech" }, { id: "rj.9.61", produced: false, now: "DeepTech › Space Tech" }];
    const r = marksForNewClassifications(rows, marks, [], () => undefined, "n");
    expect(r.marks).toHaveLength(1);
    expect(r.marks[0].verdict).toBe("correct");
    expect(marksForNewClassifications(rows, marks, ["rj.9.61"], () => undefined, "n").marks[0].verdict).toBe("wrong");
  });
});

import { classifierVersion, cacheKey, currentEntries, toCacheFile } from "./sectorCache";
describe("sector cache", () => {
  it("the version follows the definitions and the model; the key follows version, company and description", () => {
    const v = classifierVersion("haiku");
    expect(classifierVersion("haiku")).toBe(v);
    expect(classifierVersion("other-model")).not.toBe(v);
    expect(cacheKey(v, "A", "d")).toBe(cacheKey(v, "A", "d"));
    expect(cacheKey(v, "A", "d")).not.toBe(cacheKey(v, "A", "d2"));
    expect(cacheKey(v, "A", "d")).not.toBe(cacheKey("other", "A", "d"));
  });
  it("only the current version's answers are reused", () => {
    const e = new Map<string, string | null>([["k", "DeepTech › Space Tech"], ["n", null]]);
    const file = toCacheFile("v1", e);
    expect([...currentEntries(file, "v1")]).toEqual([["k", "DeepTech › Space Tech"], ["n", null]]);
    expect(currentEntries(file, "v2").size).toBe(0);
    expect(currentEntries(null, "v1").size).toBe(0);
  });
});
