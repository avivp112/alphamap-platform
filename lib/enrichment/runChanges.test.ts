import { describe, it, expect } from "vitest";
import { startupChanges, roundInsertChange, roundUpdateChanges, roundDeleteChange, planUndo, type FieldChangeRow } from "./runChanges";

// What the 2026-10-26 run wrote, as it is recorded from now on.
const RUN = "run-2026-10-26";
const chaliceBefore = { competitors: [{ name: "Cognitiv", how_it_competes: "Custom bidding." }] };
const chaliceAfter = [...chaliceBefore.competitors,
  { name: "Powerlytics", how_it_competes: "Powerlytics is listed as a similar company to Chalice AI in the advertising services space." }];
const aheadBefore = { patents: null, patent_count: null };
const aheadPatents = [{ title: "Image based tracking in augmented reality systems", patent_number: "US10102680B2" }];
const betaRound = { startup_id: "beta", round_type: "Debt", amount_raised: 169_000_000, source_url: "https://app.dealroom.co/companies/beta_air_1" };

const changes: FieldChangeRow[] = [
  ...startupChanges("chalice", chaliceBefore, { competitors: chaliceAfter, city: "New York" }, RUN),
  ...startupChanges("1ahead", aheadBefore, { patents: aheadPatents }, RUN),
  roundInsertChange("beta", "r-beta", betaRound, RUN),
  ...roundUpdateChanges("biotia", "r-biotia", { round_type: "Growth", lead_investor: null }, { lead_investor: "OCA Ventures" }, RUN),
];
const now = {
  startups: new Map<string, Record<string, unknown>>([
    ["chalice", { competitors: chaliceAfter, city: "New York" }],
    ["1ahead", { patents: aheadPatents }],
  ]),
  rounds: new Map<string, Record<string, unknown>>([["r-beta", { id: "r-beta", ...betaRound }], ["r-biotia", { id: "r-biotia", lead_investor: "OCA Ventures" }]]),
};
const SCOPE = ["patents", "patent_count", "patent_fields", "competitors", "funding_rounds"];

describe("a run is undone by its run_id (owner, 2026-10-26)", () => {
  it("records what each write replaced", () => {
    expect(changes.find((c) => c.field === "competitors")).toMatchObject({ startup_id: "chalice", old_value: chaliceBefore.competitors, new_value: chaliceAfter, run_id: RUN });
    expect(changes.find((c) => c.field === "funding_rounds.r-beta")).toMatchObject({ old_value: null, new_value: betaRound, source_url: betaRound.source_url });
    expect(changes.find((c) => c.field === "funding_rounds.r-biotia.lead_investor")).toMatchObject({ old_value: null, new_value: "OCA Ventures" });
  });

  it("puts back Chalice's competitors without Powerlytics, and 1AHEAD's patents as they were", () => {
    const actions = planUndo(changes, now, SCOPE);
    expect(actions).toContainEqual({ kind: "restore_startup_field", startup_id: "chalice", field: "competitors", value: chaliceBefore.competitors, written: chaliceAfter });
    expect(actions).toContainEqual({ kind: "restore_startup_field", startup_id: "1ahead", field: "patents", value: null, written: aheadPatents });
  });

  it("deletes BETA's Dealroom-only debt round the run inserted, and empties the lead it filled on Biotia's round", () => {
    const actions = planUndo(changes, now, SCOPE);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "delete_round", startup_id: "beta", round_id: "r-beta" }));
    expect(actions).toContainEqual({ kind: "restore_round_field", startup_id: "biotia", round_id: "r-biotia", column: "lead_investor", value: null });
  });

  it("leaves fields outside the chosen ones — Chalice's city stays", () => {
    expect(planUndo(changes, now, SCOPE)).toContainEqual({ kind: "skip", startup_id: "chalice", field: "city", reason: "out_of_scope" });
  });

  it("never overwrites a value changed after the run — it reports it instead", () => {
    const edited = { ...now, startups: new Map(now.startups).set("chalice", { competitors: [{ name: "Cognitiv" }, { name: "Index Exchange" }] }) };
    expect(planUndo(changes, edited, SCOPE)).toContainEqual({ kind: "skip", startup_id: "chalice", field: "competitors", reason: "changed_since" });
    const gone = { ...now, rounds: new Map([...now.rounds].filter(([id]) => id !== "r-beta")) };
    expect(planUndo(changes, gone, SCOPE)).toContainEqual({ kind: "skip", startup_id: "beta", field: "funding_rounds.r-beta", reason: "round_gone" });
  });

  it("puts back a round the legacy cleanup deleted — BETA's Dealroom debt round, if the owner undoes the cleanup", () => {
    const cleanup = [roundDeleteChange("beta", "r-beta", { id: "r-beta", ...betaRound }, "run-cleanup")];
    const after = { ...now, rounds: new Map([...now.rounds].filter(([id]) => id !== "r-beta")) };
    expect(planUndo(cleanup, after, SCOPE)).toEqual([{ kind: "restore_round", startup_id: "beta", round_id: "r-beta", round: { id: "r-beta", ...betaRound } }]);
    expect(planUndo(cleanup, now, SCOPE)).toEqual([{ kind: "skip", startup_id: "beta", field: "funding_rounds.r-beta", reason: "round_back" }]);
  });
});
