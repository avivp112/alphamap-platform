import { describe, it, expect } from "vitest";
import { hasStrongSignal, watchEvents, promotionReason, type WatchInput } from "./candidate-watch";
import type { Signal } from "./candidate-signals";

const sig = (kind: Signal["kind"], level: Signal["level"]): Signal => ({ kind, level, text: kind });

describe("hasStrongSignal", () => {
  it("a share allotment, a known company, an investor PSC or a serial founder is strong", () => {
    for (const k of ["share_allotment", "known_company_link", "known_company_psc", "investor_psc", "serial_founder"] as const) {
      expect(hasStrongSignal([sig(k, "positive")])).toBe(true);
    }
  });
  it("one other directorship (a serial_founder note) is not strong", () => {
    expect(hasStrongSignal([sig("serial_founder", "info")])).toBe(false);
  });
  it("warnings, notes and a mere serial_founder note are not", () => {
    expect(hasStrongSignal([sig("many_directorships", "warning"), sig("psc_summary", "info"), sig("holding_psc", "warning")])).toBe(false);
    expect(hasStrongSignal([sig("serial_founder", "info")])).toBe(false);
    expect(hasStrongSignal([])).toBe(false);
    expect(hasStrongSignal(undefined)).toBe(false);
  });
  it("a strong signal next to a warning stays strong: the reviewer sees both", () => {
    expect(hasStrongSignal([sig("share_allotment", "positive"), sig("shared_address", "warning")])).toBe(true);
  });
});

describe("watchEvents", () => {
  const base: WatchInput = { companyNumber: "14567890", filingHistory: { items: [] }, directorsNow: 2, directorsAtStart: 2, crossSource: [] };
  it("nothing happened: no event", () => { expect(watchEvents(base)).toEqual([]); });
  it("a null filing history is no event either", () => { expect(watchEvents({ ...base, filingHistory: null })).toEqual([]); });
  it("SH01, share class change and new articles", () => {
    const ev = watchEvents({ ...base, filingHistory: { items: [
      { type: "SH01", date: "2026-11-02" }, { type: "SH01", date: "2026-12-01" },
      { type: "SH08", date: "2026-12-02" }, { type: "RES01", date: "2026-12-03" }, { type: "AA", date: "2026-12-04" }, { type: "RES15", date: "2026-12-05" },
    ] } });
    expect(ev.map((e) => e.kind)).toEqual(["share_allotment", "share_class", "new_articles"]);
    expect(ev[0].text).toBe("Share allotment filed (2, latest 2026-12-01)");
  });
  it("the third director is an event only if the company did not have three already", () => {
    expect(watchEvents({ ...base, directorsNow: 3 }).map((e) => e.kind)).toEqual(["third_director"]);
    expect(watchEvents({ ...base, directorsNow: 4, directorsAtStart: 3 })).toEqual([]);
    expect(watchEvents({ ...base, directorsNow: null })).toEqual([]);
  });
  it("another source with the same name is an event and says it is by name", () => {
    const ev = watchEvents({ ...base, crossSource: [{ source: "epo_ops", name: "Lumen Quantum Ltd", status: "pending" }] });
    expect(ev[0]).toEqual({ kind: "other_source", text: "Same name as EPO patents: Lumen Quantum Ltd (by name only)" });
  });
  it("the reason joins the events", () => {
    expect(promotionReason([{ kind: "third_director", text: "a" }, { kind: "share_class", text: "b" }])).toBe("a; b");
  });
});
