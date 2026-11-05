import { describe, it, expect } from "vitest";
import { auditSearches, overlap, auditText } from "./searchAudit";

const q = (label: string, query: string, cached = false) => ({ label, query, provider: "serper", cached });
describe("search audit", () => {
  const run = {
    a: { output: { search_log: [q("overview", '"Acme" company overview headquarters founded'), q("headquarters", '"Acme" headquarters company overview founded'), q("funding", '"Acme" raised funding round seed', true), q("funding", '"Acme" raised funding round seed 2', false)] } },
    b: { output: { search_log: [q("overview", '"Bolt" company overview headquarters founded')] } },
    c: { output: null },
  };
  it("counts paid and cached searches per label and prices the paid ones", () => {
    const r = auditSearches(run, { a: "Acme" }, 0.001);
    expect(r.paid).toBe(4); expect(r.cached).toBe(1); expect(r.calls).toBe(5); expect(r.companies).toBe(2); expect(r.withoutLog).toBe(1);
    expect(r.labels.find((l) => l.label === "overview")).toMatchObject({ paid: 2, cached: 0, calls: 2 });
    expect(r.cost_usd).toBeCloseTo(0.005);
  });
  it("finds queries of one company that say the same thing", () => {
    const r = auditSearches(run, { a: "Acme" });
    expect(r.repeats.some((x) => x.labels.includes("overview") && x.labels.includes("headquarters") && x.company === "Acme")).toBe(true);
    expect(overlap("Acme founders CEO", "Bolt payments checkout")).toBe(0);
  });
  it("says so when no run carries a log", () => {
    expect(auditText(auditSearches({ a: { output: null } }))).toContain("No company carries a search log");
  });
});
