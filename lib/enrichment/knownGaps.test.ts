import { describe, it, expect } from "vitest";
import { recordGaps, purgeWrong, missingRows, gapFor, ownerWrongKeys, type GapStore } from "./knownGaps";
import { markKey } from "./knownSources";
import { remember, type KnownStore } from "./knownSources";

describe("known gaps (owner, round 10)", () => {
  const lines = ["    🔎  Fixed searches: raises (4 result(s)), founded_by (2 result(s))", "    🚫  leader Ann Lee not written — no allowed source gives the title \"CEO\"", "    🏢  Headquarters Tel Aviv — the latest press declaration", "    🚫  founder Bob dropped — not on the allowed list"];
  it("keeps what was searched and the refusals that speak about the field", () => {
    const g: GapStore = {};
    recordGaps(g, "c1", "Acme", ["leader", "founder", "round"], lines, "r1", "2026-11-15");
    expect(g.c1.fields.leader.rejected_candidates[0]).toMatch(/Ann Lee/);
    expect(g.c1.fields.founder.rejected_candidates[0]).toMatch(/Bob/);
    expect(g.c1.fields.round.rejected_candidates).toEqual([]);
    expect(g.c1.fields.round.searched[0]).toMatch(/Fixed searches/);
  });
  it("a field found since leaves the gaps; the owner's refusal stays", () => {
    const g: GapStore = {};
    recordGaps(g, "c1", "Acme", ["leader", "founder"], lines, "r1", "2026-11-15");
    recordGaps(g, "c1", "Acme", ["founder"], lines, "r2", "2026-11-16");
    expect(Object.keys(g.c1.fields)).toEqual(["founder"]);
  });
  it("what the owner marked wrong leaves the memory and is a refused candidate", () => {
    const store: KnownStore = {}; const g: GapStore = {};
    remember(store, [{ company_id: "c1", company: "Acme", field: "founder", before: "", after: "Bad Name", source_url: "https://x.com", quote: "q" }], "r1", "2026-11-01");
    const removed = purgeWrong(store, g, (_c, f, v) => f === "founder" && v === "Bad Name", "2026-11-15");
    expect(removed).toHaveLength(1);
    expect(store.c1).toEqual([]);
    const rows = missingRows(g, ["c1"], new Set());
    expect(rows[0].reason).toMatch(/found and refused: marked wrong by the owner/);
  });
  it("reasons: no source found / site not read", () => {
    const g: GapStore = {};
    recordGaps(g, "c1", "Acme", ["round"], [], "r1", "2026-11-15");
    expect(missingRows(g, ["c1"], new Set())[0].reason).toBe("no source found");
    expect(missingRows(g, ["c1"], new Set(["Acme"]))[0].reason).toBe("site not read");
    expect(gapFor("zzz", lines).rejected).toEqual([]);
  });
  it("what the owner removed is not taken back by a rebuilt memory", () => {
    const store: KnownStore = {}; const g: GapStore = {};
    remember(store, [{ company_id: "c1", company: "Acme", field: "round", before: "", after: "Other $25M · 2022-04-19 · Goldman Sachs", source_url: "https://x.com/a", quote: "q" }], "r1", "2026-11-01");
    purgeWrong(store, g, (_c, f) => f === "round", "2026-11-15");
    const keys = ownerWrongKeys(g, markKey);
    expect(keys.has(markKey("Acme", "round", "Other $25M · 2022-04-19 · Goldman Sachs"))).toBe(true);
    const again: KnownStore = {};
    remember(again, [{ company_id: "c1", company: "Acme", field: "round", before: "", after: "Other $25M · 2022-04-19 · Goldman Sachs", source_url: "https://x.com/a", quote: "q" }], "r2", "2026-11-16", keys);
    expect(again.c1 ?? []).toEqual([]);
  });
});
