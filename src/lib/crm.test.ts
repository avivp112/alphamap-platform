import { describe, it, expect } from "vitest";
import { documentPath, documentProblem, fmtBytes, isOverdue, normalizeTags, parseMoney, sortCrm, stageCounts, totalInvested, MAX_DOCUMENT_BYTES } from "./crm";

describe("pipeline", () => {
  it("counts per stage, every stage present", () => {
    expect(stageCounts([{ stage: "watching" }, { stage: "invested" }, { stage: "watching" }]))
      .toEqual({ all: 3, watching: 2, reviewing: 0, diligence: 0, term_sheet: 0, invested: 1, passed: 0 });
  });
  it("overdue next steps first, then by date, then recently touched", () => {
    const rows = [
      { id: "a", next_step_date: null, updated_at: "2026-10-18" },
      { id: "b", next_step_date: "2026-10-25", updated_at: "2026-10-01" },
      { id: "c", next_step_date: "2026-10-10", updated_at: "2026-10-01" },
      { id: "d", next_step_date: null, updated_at: "2026-10-19" },
    ];
    expect(sortCrm(rows, "2026-10-18").map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
    expect([isOverdue("2026-10-10", "2026-10-18"), isOverdue("2026-10-18", "2026-10-18"), isOverdue(null, "2026-10-18")]).toEqual([true, false, false]);
  });
});

describe("forms", () => {
  it("tags: trimmed, de-duplicated", () => {
    expect(normalizeTags("  AI ,fintech,ai , ")).toEqual(["AI", "fintech"]);
  });
  it("money as investors type it", () => {
    expect(["1,500,000", "1.5m", "250k", "$2b", "", "abc"].map(parseMoney)).toEqual([1500000, 1500000, 250000, 2000000000, null, Number.NaN]);
  });
  it("total invested only from the amounts entered", () => {
    expect(totalInvested([{ amount: 250000 }, { amount: null }, { amount: 100000 }])).toBe(350000);
    expect(totalInvested([{ amount: null }])).toBeNull();
  });
});

describe("documents", () => {
  it("path inside the user's own folder for that company, safe file name", () => {
    expect(documentPath("u1", "c1", "Term Sheet (final) v2.pdf", 1700000000000)).toBe("u1/c1/1700000000000-Term_Sheet_final_v2.pdf");
    expect(documentPath("u1", "c1", "../../etc/passwd", 1)).toBe("u1/c1/1-etc_passwd");
  });
  it("size checks match the bucket limit", () => {
    expect(documentProblem({ size: MAX_DOCUMENT_BYTES + 1, name: "x" })).toBe("too_large");
    expect(documentProblem({ size: 0, name: "x" })).toBe("empty");
    expect(documentProblem({ size: 1000, name: "x" })).toBeNull();
    expect(fmtBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
