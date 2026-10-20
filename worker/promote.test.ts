import { describe, it, expect, vi, beforeEach } from "vitest";

const writeCollected = vi.fn(async () => ({ anyWrite: true }));
vi.mock("../lib/enrichment/writeCompany.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/enrichment/writeCompany.ts")>()),
  writeCollected: (...a: unknown[]) => (writeCollected as unknown as (...x: unknown[]) => unknown)(...a),
}));

import { serializeCollected, deserializeCollected, freshRow, promoteOne, type PromotionJob } from "./promote";
import type { CollectedCompany } from "../lib/enrichment/collect";
import type { LabeledSource } from "../lib/enrichment/sources";

const sources = [
  { source_id: "S1", source_type: "press_release", url: "https://pr.example/nuova-seed", title: "Nuova raises", query_label: "history", content: "a long press release ...", provider: "serper" },
  { source_id: "W1", source_type: "company_site", url: "https://nuova.ai/about", title: "About", query_label: "website", content: "page text ...", provider: "jina" },
] as LabeledSource[];

function collected(): CollectedCompany {
  const byId = new Map(sources.map((s) => [s.source_id, s]));
  return {
    outcome: "collected",
    profile: { profile: { description: "Nuova predicts supply-chain disruptions.", founded_year: { value: 2023, source_id: "S1", evidence_quote: "founded in 2023" } } } as unknown as CollectedCompany["profile"],
    funding: { funding_rounds: [], funding_history_complete: true, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] } as unknown as CollectedCompany["funding"],
    market: { competitors: [] } as unknown as CollectedCompany["market"],
    allSources: sources, sourceById: byId,
    sourceTypeFor: (id) => (id ? byId.get(id)?.source_type : undefined),
    sourceUrlFor: (id) => (id ? byId.get(id)?.url ?? null : null),
    linkedinFounders: [], linkedinLeaders: [], existingRefs: [],
    validation: { accepted: { founded_year: 2023 }, acceptedRounds: [] } as unknown as CollectedCompany["validation"],
    plan: { inserts: [{ round_type: "Seed", amount_raised: 8_000_000 }], updates: [], conflicts: [] } as unknown as CollectedCompany["plan"],
    cityConfidence: 0, countryConfidence: 70, domain: "nuova.ai",
  };
}

describe("the stored research", () => {
  it("survives the database (JSON) and rebuilds the source lookups", () => {
    const back = deserializeCollected(JSON.parse(JSON.stringify(serializeCollected(collected()))));
    const orig = collected();
    expect(back.sourceTypeFor("S1")).toBe("press_release");
    expect(back.sourceUrlFor("W1")).toBe("https://nuova.ai/about");
    expect(back.sourceById.get("S1")?.url).toBe(orig.sourceById.get("S1")?.url);
    expect(back.plan).toEqual(orig.plan);
    expect(back.profile).toEqual(orig.profile);
    expect(back.validation).toEqual(orig.validation);
  });
  it("keeps what the write stage reads and drops the page text", () => {
    const stored = serializeCollected(collected());
    expect(stored.allSources).toEqual([
      { source_id: "S1", source_type: "press_release", url: "https://pr.example/nuova-seed", title: "Nuova raises", query_label: "history" },
      { source_id: "W1", source_type: "company_site", url: "https://nuova.ai/about", title: "About", query_label: "website" },
    ]);
    expect(JSON.stringify(stored)).not.toContain("page text");
    expect("sourceTypeFor" in stored).toBe(false);
  });
});

describe("freshRow", () => {
  it("is a company with nothing on file but its name and website — not what the user typed", () => {
    const r = freshRow("s-1", "Nuova AI", "https://nuova.ai");
    expect([r.id, r.name, r.website, r.country, r.founders, r.city]).toEqual(["s-1", "Nuova AI", "https://nuova.ai", null, null, null]);
  });
});

// A fake database: the four RPCs and the startups domain listing.
function fakeDb(job: PromotionJob | null, opts: { startError?: string } = {}) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ name, args });
      if (name === "claim_check_promotion") return { data: job, error: null };
      if (name === "start_check_promotion_write") return opts.startError ? { data: null, error: { message: opts.startError } } : { data: "new-startup", error: null };
      return { data: null, error: null };
    }),
    from: () => {
      const q = { select: () => q, not: () => q, order: () => q, range: async () => ({ data: [{ id: "other", name: "Other", website: "https://www.other.io" }], error: null }) };
      return q;
    },
  };
  return { db: db as never, rpcs };
}

const job = (): PromotionJob => ({
  id: "p-1", check_id: "c-1", user_id: "u-1", name: "Nuova AI", website: "https://nuova.ai",
  collected: JSON.parse(JSON.stringify(serializeCollected(collected()))),
});

const deps = (db: never, existing: { id: string; name: string } | null = null) => ({
  db, taxonomy: async () => ({}) as never, findExisting: vi.fn(async () => existing), notify: vi.fn(async () => {}), log: () => {},
});

describe("promoteOne", () => {
  beforeEach(() => writeCollected.mockClear());

  it("nothing approved: nothing done", async () => {
    const { db, rpcs } = fakeDb(null);
    expect(await promoteOne(deps(db))).toBe(false);
    expect(rpcs.map((r) => r.name)).toEqual(["claim_check_promotion"]);
  });

  it("writes an approved company with v2's write stage, as a real (not dry) bulk write", async () => {
    const { db, rpcs } = fakeDb(job());
    const d = deps(db);
    expect(await promoteOne(d)).toBe(true);
    expect(rpcs.map((r) => r.name)).toEqual(["claim_check_promotion", "start_check_promotion_write", "refresh_startups_search", "finish_check_promotion"]);
    expect(rpcs[3].args).toEqual({ p_id: "p-1", p_status: "written", p_startup_id: "new-startup", p_error: null });
    const [row, written, ctx] = writeCollected.mock.calls[0] as unknown as [ReturnType<typeof freshRow>, CollectedCompany, Record<string, unknown>];
    expect([row.id, row.name, row.website, row.country]).toEqual(["new-startup", "Nuova AI", "https://nuova.ai", null]);
    expect(written.plan).toEqual(collected().plan);   // the research the admin saw, not a new one
    expect(ctx).toMatchObject({ dryRun: false, update: false, thresholds: { minProfileConfidence: 40, minFundingConfidence: 60 }, seen: null });
    expect((ctx.startupByDomain as Map<string, unknown>).get("other.io")).toEqual({ id: "other", name: "Other" });
    expect(d.notify).toHaveBeenCalledWith("u-1", "Nuova AI is in AlphaMap", expect.any(String), "/checks/c-1");
  });

  it("already in AlphaMap (same website): linked, nothing written over it", async () => {
    const { db, rpcs } = fakeDb(job());
    expect(await promoteOne(deps(db, { id: "known", name: "Nuova" }))).toBe(true);
    expect(writeCollected).not.toHaveBeenCalled();
    expect(rpcs.map((r) => r.name)).toEqual(["claim_check_promotion", "finish_check_promotion"]);
    expect(rpcs[1].args).toMatchObject({ p_status: "linked", p_startup_id: "known" });
  });

  it("a failure is recorded on the proposal, for the admin to see", async () => {
    const { db, rpcs } = fakeDb(job(), { startError: "duplicate key" });
    expect(await promoteOne(deps(db))).toBe(true);
    expect(writeCollected).not.toHaveBeenCalled();
    expect(rpcs.at(-1)).toMatchObject({ name: "finish_check_promotion", args: { p_status: "failed", p_startup_id: null } });
    expect(String(rpcs.at(-1)?.args.p_error)).toContain("duplicate key");
  });
});

describe("promoteOne — an approved update to an AlphaMap company", () => {
  beforeEach(() => writeCollected.mockClear());
  it("writes to the company as it is now, with the rounds planned again against today's file", async () => {
    const stored = collected();
    stored.validation = { accepted: {}, acceptedRounds: [{ round_type: "Seed", amount_raised: 8_000_000, announcement_date: "2025-05-10", _new: true }] } as never;
    stored.plan = { inserts: [{ round_type: "Seed", amount_raised: 8_000_000 }], updates: [], conflicts: [] } as never;   // planned when the file had no Seed
    const updateJob: PromotionJob = { ...job(), kind: "update", startup_id: "s-7", collected: JSON.parse(JSON.stringify(serializeCollected(stored))) };
    const { db, rpcs } = fakeDb(updateJob);
    const today = { row: freshRow("s-7", "Nuova AI", "https://nuova.ai"), rounds: [{ id: "r-1", startup_id: "s-7", round_type: "Seed", amount_raised: 8_000_000, valuation: null, is_valuation_estimated: null, announcement_date: "2025-05-10", source_url: null, lead_investor: null, investors: null, investor_amounts: null }] };
    const d = { ...deps(db), loadCompany: vi.fn(async () => today) };
    expect(await promoteOne(d as never)).toBe(true);
    const [row, written, ctx] = writeCollected.mock.calls[0] as unknown as [{ id: string }, CollectedCompany, { dryRun: boolean }];
    expect(row.id).toBe("s-7");
    expect(ctx.dryRun).toBe(false);
    expect(written.plan.inserts).toEqual([]);   // the Seed added meanwhile is not written twice
    expect(rpcs.map((r) => r.name)).toEqual(["claim_check_promotion", "refresh_startups_search", "finish_check_promotion"]);
    expect(rpcs[2].args).toMatchObject({ p_status: "written", p_startup_id: "s-7" });
  });
  it("a company that left AlphaMap: the update fails, nothing written", async () => {
    const { db, rpcs } = fakeDb({ ...job(), kind: "update", startup_id: "s-7" });
    expect(await promoteOne({ ...deps(db), loadCompany: vi.fn(async () => null) } as never)).toBe(true);
    expect(writeCollected).not.toHaveBeenCalled();
    expect(rpcs.at(-1)?.args).toMatchObject({ p_status: "failed" });
  });
});
