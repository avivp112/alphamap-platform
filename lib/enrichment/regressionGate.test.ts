import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compare, watched, valueKey, acceptanceErrors, passFor, passFileName } from "./regressionGate";
import { fieldErrors, ERROR_LIMIT } from "./batchProcess";

const base = [
  { company: "Ardens Health Informatics", field: "founded_year", value: "2013" },
  { company: "Ardens Health Informatics", field: "description", value: "Ardens provides clinical decision support tools." },
  { company: "Inipharm", field: "founder", value: "Brian Farmer — Co-Founder, CEO" },
  { company: "Inipharm", field: "founder", value: "Jane Roe — Co-Founder" },
  { company: "Kontent.ai", field: "round", value: "Growth $40M · 2022-07" },
];
describe("the regression gate's comparison", () => {
  it("nothing lost, nothing new: the same values", () => {
    const c = compare(base, base);
    expect(c).toEqual({ lost: [], added: [], changed: [] });
  });
  it("a value that is gone is lost, with the reason the run gave", () => {
    const now = base.filter((v) => v.value !== "2013");
    const c = compare(base, now, [{ company: "Ardens Health Informatics", field: "founded_year", value: "2013", reason_code: "sentence_not_about_company" }]);
    expect(c.lost).toHaveLength(1);
    expect(c.lost[0]).toMatchObject({ company: "Ardens Health Informatics", field: "founded_year", reason_code: "sentence_not_about_company" });
  });
  it("a lost value with no rejection says so", () => {
    const c = compare(base, base.filter((v) => v.field !== "round"));
    expect(c.lost[0].reason_code).toBe("not_found_now");
  });
  it("one of several values lost (a founder), the others stay", () => {
    const c = compare(base, base.filter((v) => !v.value.startsWith("Brian")));
    expect(c.lost.map((l) => l.value)).toEqual(["Brian Farmer — Co-Founder, CEO"]);
  });
  it("a single-valued field with another value now is changed, not lost; with none it is lost", () => {
    const changed = compare(base, [...base.filter((v) => v.field !== "description"), { company: "Ardens Health Informatics", field: "description", value: "Ardens sells software." }]);
    expect(changed.lost).toEqual([]);
    expect(changed.changed).toHaveLength(1);
    expect(changed.added).toEqual([]);
    expect(compare(base, base.filter((v) => v.field !== "description")).lost).toHaveLength(1);
  });
  it("new values are listed apart", () => {
    const c = compare(base, [...base, { company: "Inipharm", field: "round", value: "Series A $35M" }]);
    expect(c.lost).toEqual([]);
    expect(c.added.map((a) => a.value)).toEqual(["Series A $35M"]);
  });
  it("what is not a value of the company is not watched; case, spaces and punctuation do not matter", () => {
    expect(watched([{ company: "X", field: "name_proposal", value: "x" }, { company: "X", field: "(nothing)", value: "" }, { company: "X", field: "headcount_history", value: "5 on 2026-01-01" }])).toEqual([]);
    expect(valueKey("Kontent.ai", "round", "Growth $40M · 2022-07")).toBe(valueKey("kontent ai", "round", "growth  $40M — 2022-07"));
    expect(valueKey("A", "description_what_only", "x")).toBe(valueKey("A", "description", "x"));
  });
  it("an acceptance ERROR fails, a gap does not", () => {
    expect(acceptanceErrors([{ id: "a", severity: "error", pass: false, detail: "d" }, { id: "b", severity: "gap", pass: false }, { id: "c", severity: "error", pass: true }])).toEqual([{ id: "a", detail: "d" }]);
  });
});

describe("the pass file", () => {
  it("is the commit's own, or any of the same code (the same tree)", () => {
    const dir = mkdtempSync(join(tmpdir(), "reg-"));
    try {
      const pass = { commit: "abcdef1234567890", tree: "TREE1", at: "t", batches: [5, 6, 7], values: 10, cost_usd: 0 };
      writeFileSync(join(dir, passFileName(pass.commit)), JSON.stringify(pass));
      expect(passFor("abcdef1234567890", "TREE1", dir)?.values).toBe(10);
      expect(passFor("abcdef1234567890", "OTHER", dir)).toBeNull();              // the file is of other code under the same name
      expect(passFor("ffffffffffff0000", "TREE1", dir)?.values).toBe(10);         // a merge commit with the same content
      expect(passFor("ffffffffffff0000", "TREE2", dir)).toBeNull();
      expect(passFor("", "TREE1", dir)).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("errors per field in the sample (owner, 2026-11-19: up to 5% is fine)", () => {
  const sample = Array.from({ length: 40 }, (_, i) => ({ n: i + 1, company: `C${i}`, field: i < 20 ? "round" : "tags", value: `v${i}` }));
  it("one wrong in twenty is 5%: fine; two is 10%: the field is held; the other field is untouched", () => {
    const one = fieldErrors(sample, new Set([1]));
    expect(one.find((e) => e.field === "round")).toMatchObject({ wrong: 1, total: 20, held: false });
    const two = fieldErrors(sample, new Set([1, 2, 25]));
    expect(two.find((e) => e.field === "round")?.held).toBe(true);
    expect(two.find((e) => e.field === "tags")).toMatchObject({ wrong: 1, total: 20, held: false });
    expect(ERROR_LIMIT).toBe(0.05);
  });
});

import { addPendingFixes, pendingExcludes, addHeldFields, heldFieldsOf, outstandingHeld } from "./batchProcess";
describe("pending_fixes.csv and held_fields.csv", () => {
  it("excludes by content, per batch; a fix is listed once; a held field is held until its completion", () => {
    const dir = mkdtempSync(join(tmpdir(), "proc-"));
    try {
      const pf = join(dir, "pending_fixes.csv"), hf = join(dir, "held_fields.csv");
      addPendingFixes([{ batch: 8, company: "Acme, Inc.", field: "tags", value: "Insurance / Insurtech", reason: "assurance vie" }], pf, "2026-11-19");
      addPendingFixes([{ batch: 8, company: "Acme, Inc.", field: "tags", value: "Insurance / Insurtech", reason: "assurance vie" }, { batch: 9, company: "Beta", field: "founder", value: "X — CEO", reason: "wrong" }], pf, "2026-11-19");
      expect(pendingExcludes(8, pf).map((f) => f.token)).toEqual(["Acme, Inc.:tags:Insurance / Insurtech"]);
      expect(pendingExcludes(9, pf)).toHaveLength(1);
      expect(pendingExcludes(10, pf)).toEqual([]);
      addHeldFields([{ batch: 8, field: "news", source: "sample_50", detail: "2/10 wrong" }, { batch: 8, field: "news", source: "acceptance: x", detail: "again" }], hf, "2026-11-19");
      expect(heldFieldsOf(8, hf)).toEqual(["news"]);
      expect(outstandingHeld(hf)).toHaveLength(1);
      expect(heldFieldsOf(9, hf)).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
