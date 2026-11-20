import { describe, expect, it } from "vitest";
import { accumulate, decide, draw, pilotVisible, type AuditRow } from "./audit.ts";

const rows: AuditRow[] = Array.from({ length: 200 }, (_, i) => ({ company: `Co${i % 100}`, company_id: `id${i % 100}`, field: i % 3 === 0 ? "round" : i % 3 === 1 ? "hq_city" : "description", value: `v${i}`, source_url: i % 5 ? "https://example.com/a" : "", quote: i % 4 ? "a long enough quote to count as a quote of the page itself" : "" }));
describe("post-write audit", () => {
  it("draws 25 random and 25 targeted, reproducibly, at most two targeted per company, core fields only", () => {
    const d = draw([...rows, { company: "X", company_id: "x", field: "tags", value: "t", source_url: "", quote: "" }], 8);
    expect(d).toHaveLength(50);
    expect(d.filter((x) => x.kind === "random")).toHaveLength(25);
    expect(d.some((x) => x.field === "tags")).toBe(false);
    expect(draw(rows, 8).map((x) => x.value)).toEqual(draw(rows, 8).map((x) => x.value));
    const per = new Map<string, number>(); for (const x of d.filter((y) => y.kind === "targeted")) per.set(x.company_id, (per.get(x.company_id) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2);
  });
  it("undoes a field when the targeted sample has errors in more than 5 companies", () => {
    const d = draw(rows, 3);
    const t = d.filter((x) => x.kind === "targeted" && x.field === "hq_city");
    const wrong = new Set(t.slice(0, 6).map((x) => x.n));
    const v = decide(d, wrong, {});
    expect(v.find((x) => x.field === "hq_city")!.undo).toBe(t.slice(0, 6).length > 5 && new Set(t.slice(0, 6).map((x) => x.company_id)).size > 5);
  });
  it("random accuracy under the tier bar undoes only after enough values", () => {
    const d = draw(rows, 4);
    const cum = { description: { audited: 40, wrong: 4, batches: {} } };
    expect(decide(d, new Set(), cum).find((x) => x.field === "description")!.undo).toBe(true);
    expect(decide(d, new Set(), { description: { audited: 10, wrong: 4, batches: {} } }).find((x) => x.field === "description")!.undo).toBe(false);
  });
  it("a field is visible only with 150 random values above its bar; a batch is counted once", () => {
    expect(pilotVisible("description", { description: { audited: 149, wrong: 0, batches: {} } }).visible).toBe(false);
    expect(pilotVisible("description", { description: { audited: 150, wrong: 8, batches: {} } }).visible).toBe(false);
    expect(pilotVisible("description", { description: { audited: 150, wrong: 7, batches: {} } }).visible).toBe(true);
    expect(pilotVisible("round", { round: { audited: 150, wrong: 3, batches: {} } }).visible).toBe(false);
    const d = draw(rows, 9), a = accumulate({}, 9, d, new Set()), b = accumulate(a, 9, d, new Set());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
