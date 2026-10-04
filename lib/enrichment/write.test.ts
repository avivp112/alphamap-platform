import { describe, it, expect } from "vitest";
import {
  decideScalarWrite, decideHeadcountUpdate, mergePeople, appendDatedFigures,
  fillArrayIfEmpty, fillScalarIfNull, type MergeablePerson,
} from "./write";

describe("decideScalarWrite", () => {
  it("fills a field with no existing value", () => {
    const result = decideScalarWrite(
      { value: null, provenance: null },
      { value: "London", source_type: "aggregator_snippet", independentSourceCount: 1 },
    );
    expect(result.decision).toBe("fill");
  });

  it("never overwrites a manually-verified value, even with a registry-sourced candidate", () => {
    const result = decideScalarWrite<string>(
      { value: "United Kingdom", provenance: { source_type: "model_inferred", is_manually_verified: true } },
      { value: "United States", source_type: "registry", independentSourceCount: 3 },
    );
    expect(result.decision).toBe("keep_existing");
  });

  it("overwrites when the candidate outranks the existing provenance", () => {
    const result = decideScalarWrite<string>(
      { value: "United States", provenance: { source_type: "model_inferred" } },
      { value: "United Kingdom", source_type: "registry", independentSourceCount: 1 },
    );
    expect(result.decision).toBe("overwrite");
  });

  it("keeps the existing value when the candidate does not outrank it", () => {
    const result = decideScalarWrite<string>(
      { value: "United States", provenance: { source_type: "company_site" } },
      { value: "United Kingdom", source_type: "news", independentSourceCount: 1 },
    );
    expect(result.decision).toBe("keep_existing");
  });

  it("overwrites a no-provenance existing value when corroborated by 2+ independent sources", () => {
    const result = decideScalarWrite<string>(
      { value: "United States", provenance: null },
      { value: "United Kingdom", source_type: "news", independentSourceCount: 2 },
    );
    expect(result.decision).toBe("overwrite");
  });

  it("keeps a no-provenance existing value when the candidate has only 1 source", () => {
    const result = decideScalarWrite<string>(
      { value: "United States", provenance: null },
      { value: "United Kingdom", source_type: "news", independentSourceCount: 1 },
    );
    expect(result.decision).toBe("keep_existing");
  });
});

describe("decideHeadcountUpdate", () => {
  it("writes observed when there's no existing headcount at all", () => {
    expect(decideHeadcountUpdate(null, { value: 50, source_type: "news", independentSourceCount: 1 }).pointType).toBe("observed");
  });

  it("accepts a change under 50% from a single weak source", () => {
    const result = decideHeadcountUpdate(100, { value: 140, source_type: "aggregator_snippet", independentSourceCount: 1 });
    expect(result.writeEmployeeCount).toBe(true);
    expect(result.pointType).toBe("observed");
  });

  it("rejects the Fresha-shape jump (140,000 from 300) on a single weak source", () => {
    const result = decideHeadcountUpdate(300, { value: 140_000, source_type: "aggregator_snippet", independentSourceCount: 1 });
    expect(result.writeEmployeeCount).toBe(false);
    expect(result.pointType).toBe("model_estimate");
  });

  it("accepts a large jump when corroborated by 2+ independent sources", () => {
    const result = decideHeadcountUpdate(300, { value: 900, source_type: "news", independentSourceCount: 2 });
    expect(result.writeEmployeeCount).toBe(true);
  });

  it("accepts a large jump from a single company_site source", () => {
    const result = decideHeadcountUpdate(300, { value: 900, source_type: "company_site", independentSourceCount: 1 });
    expect(result.writeEmployeeCount).toBe(true);
  });

  it("does NOT accept a large jump from a single press_release source alone", () => {
    const result = decideHeadcountUpdate(300, { value: 900, source_type: "press_release", independentSourceCount: 1 });
    expect(result.writeEmployeeCount).toBe(false);
  });
});

describe("mergePeople", () => {
  it("backfills missing fields onto an already-recorded person without overwriting what's already there", () => {
    const existing: MergeablePerson[] = [{ name: "Ian Cinnamon", title: "CEO" }];
    const incoming: MergeablePerson[] = [{ name: "Ian Cinnamon", title: "Founder & CEO", bio: "Previously founded Synapse." }];
    const result = mergePeople(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("CEO"); // not overwritten
    expect(result[0].bio).toBe("Previously founded Synapse."); // backfilled
  });

  it("appends a genuinely new person", () => {
    const existing: MergeablePerson[] = [{ name: "Ian Cinnamon" }];
    const incoming: MergeablePerson[] = [{ name: "Max Benassi", title: "CTO" }];
    const result = mergePeople(existing, incoming);
    expect(result).toHaveLength(2);
  });

  it("matches names case/whitespace-insensitively", () => {
    const existing: MergeablePerson[] = [{ name: "Ian Cinnamon" }];
    const incoming: MergeablePerson[] = [{ name: "  ian cinnamon  ", title: "CEO" }];
    expect(mergePeople(existing, incoming)).toHaveLength(1);
  });

  it("OR-accumulates quality flags, never resetting one back to false", () => {
    const existing: MergeablePerson[] = [{ name: "Ian Cinnamon", had_prior_exit: true }];
    const incoming: MergeablePerson[] = [{ name: "Ian Cinnamon", elite_background: true }];
    const result = mergePeople(existing, incoming);
    expect(result[0].had_prior_exit).toBe(true);
    expect(result[0].elite_background).toBe(true);
  });

  it("does not crash on an existing person with no name -- the real DRY_RUN=false crash (Falanx Cyber, pre-existing JSONB data from outside this schema)", () => {
    const existing = [{ title: "CEO" }, { name: "Ian Cinnamon" }] as MergeablePerson[];
    const incoming: MergeablePerson[] = [{ name: "Max Benassi", title: "CTO" }];
    expect(() => mergePeople(existing, incoming)).not.toThrow();
    const result = mergePeople(existing, incoming);
    expect(result).toHaveLength(3); // the nameless entry survives untouched, nothing lost
    expect(result[0]).toEqual({ title: "CEO" });
  });

  it("skips an incoming person with no name rather than appending an unreferenceable record", () => {
    const existing: MergeablePerson[] = [{ name: "Ian Cinnamon" }];
    const incoming = [{ title: "Advisor" }] as MergeablePerson[];
    const result = mergePeople(existing, incoming);
    expect(result).toHaveLength(1);
  });

  it("never lets two different nameless existing people get silently conflated into one via a shared null key", () => {
    const existing = [{ title: "CEO" }, { title: "CTO" }] as MergeablePerson[];
    const incoming: MergeablePerson[] = [{ name: "Max Benassi" }];
    const result = mergePeople(existing, incoming);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ title: "CEO" });
    expect(result[1]).toEqual({ title: "CTO" });
  });
});

describe("appendDatedFigures", () => {
  it("appends a genuinely new dated figure", () => {
    const existing = [{ date: "2024-01-01" }];
    const incoming = [{ date: "2025-01-01" }];
    const result = appendDatedFigures(existing, incoming, () => 1);
    expect(result).toHaveLength(2);
  });

  it("skips a near-duplicate (same figure, same date)", () => {
    const existing = [{ date: "2024-01-01", arr: 10_000_000 }];
    const incoming = [{ date: "2024-01-01", arr: 10_000_000 }];
    const result = appendDatedFigures(existing, incoming, (x) => x.arr);
    expect(result).toHaveLength(1);
  });

  it("keeps a different figure on the same date (a real re-report, not a dup)", () => {
    const existing = [{ date: "2024-01-01", arr: 10_000_000 }];
    const incoming = [{ date: "2024-01-01", arr: 12_000_000 }];
    const result = appendDatedFigures(existing, incoming, (x) => x.arr);
    expect(result).toHaveLength(2);
  });
});

describe("fillArrayIfEmpty / fillScalarIfNull", () => {
  it("fills an empty array but never touches a non-empty one", () => {
    expect(fillArrayIfEmpty([], ["a", "b"])).toEqual(["a", "b"]);
    expect(fillArrayIfEmpty(["existing"], ["a", "b"])).toEqual(["existing"]);
  });
  it("fills a null scalar but never touches an existing one", () => {
    expect(fillScalarIfNull(null, "new")).toBe("new");
    expect(fillScalarIfNull("existing", "new")).toBe("existing");
  });
});
