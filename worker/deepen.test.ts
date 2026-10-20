import { describe, it, expect, vi } from "vitest";
import { directWrites, applyDirectWrites, buildDiff, isEmptyDiff, runDeepen, OFFICIAL_MIN_CONFIDENCE, type DeepenDeps, type Company } from "./deepen";
import { freshRow } from "./promote";
import type { CollectedCompany } from "../lib/enrichment/collect";
import type { SourceType } from "../lib/enrichment/sourceTypes";
import type { WriteOutcome } from "../lib/enrichment/writeCompany";
import type { CheckRow } from "./queue";

// R1 a company registry page, N1 a news article.
const types: Record<string, SourceType> = { R1: "registry", N1: "news" };
const urls: Record<string, string> = { R1: "https://find-and-update.company-information.service.gov.uk/company/1", N1: "https://news.example/a" };

function collected(over: { foundedSrc?: string; countrySrc?: string; city?: string; cityConfidence?: number } = {}): CollectedCompany {
  return {
    outcome: "collected",
    profile: {
      is_public_company: false, is_tech_company: true,
      profile: {
        description: "Builds agents.",
        founded_year: { value: 2021, source_id: over.foundedSrc ?? "R1", evidence_quote: "Incorporated on 3 March 2021" },
        country: { value: "United Kingdom", source_id: over.countrySrc ?? "R1", evidence_quote: "Registered office: London, United Kingdom" },
        city: over.city ? { value: over.city, source_id: "R1", evidence_quote: `Registered office: ${over.city}` } : undefined,
        founders: [], sector_name: "AI & ML",
      },
      leadership: [], metrics: {},
    } as unknown as CollectedCompany["profile"],
    funding: { funding_rounds: [], funding_history_complete: null, arr_milestones: [], revenue_estimate: null, valuation_benchmarks: [] } as unknown as CollectedCompany["funding"],
    market: {} as CollectedCompany["market"],
    allSources: [], sourceById: new Map(),
    sourceTypeFor: (id) => (id ? types[id] : undefined),
    sourceUrlFor: (id) => (id ? urls[id] ?? null : null),
    linkedinFounders: [], linkedinLeaders: [], existingRefs: [],
    validation: { accepted: { founded_year: 2021, country: "United Kingdom", city: over.city ?? null }, acceptedRounds: [] } as unknown as CollectedCompany["validation"],
    plan: { inserts: [], updates: [], conflicts: [] } as unknown as CollectedCompany["plan"],
    cityConfidence: over.cityConfidence ?? 90, countryConfidence: 90, domain: "acme.ai",
  };
}

describe("directWrites — what is written at once", () => {
  it("an empty field filled from a registry, with high confidence", () => {
    const w = directWrites(freshRow("s1", "Acme", "https://acme.ai"), collected({ city: "London" }));
    expect(w.map((x) => [x.field, x.value])).toEqual([["founded_year", 2021], ["country", "United Kingdom"], ["city", "London"]]);
    expect(w[0]).toMatchObject({ source_url: urls.R1, quote: "Incorporated on 3 March 2021" });
    expect(OFFICIAL_MIN_CONFIDENCE).toBe(90);
  });
  it("never a field that already has a value — that is a change, and waits for review", () => {
    const row = { ...freshRow("s1", "Acme", null), founded_year: 2020, country: "Israel" };
    expect(directWrites(row, collected())).toEqual([]);
  });
  it("never from a weaker source, even into an empty field", () => {
    expect(directWrites(freshRow("s1", "Acme", null), collected({ foundedSrc: "N1", countrySrc: "N1" }))).toEqual([]);
  });
  it("a location below the bulk run's threshold is not written", () => {
    expect(directWrites(freshRow("s1", "Acme", null), collected({ city: "London", cityConfidence: 30 })).map((x) => x.field)).toEqual(["founded_year", "country"]);
  });
});

describe("applyDirectWrites", () => {
  it("writes only into a field that is still empty, with its provenance, and marks the company as written by v2", async () => {
    const calls: string[] = [];
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        let payload: Record<string, unknown> = {};
        q.update = (p: Record<string, unknown>) => { payload = p; calls.push(`update ${table} ${Object.keys(p)[0]}`); return q; };
        q.eq = () => q;
        q.is = () => q;
        q.select = async () => ({ data: payload.country ? [] : [{ id: "s1" }], error: null });   // country was filled meanwhile
        q.insert = async (row: Record<string, unknown>) => { calls.push(`provenance ${row.field} ${row.source_type}`); return { error: null }; };
        q.then = (res: (v: unknown) => void) => res({ error: null });
        return q;
      },
    };
    const w = directWrites(freshRow("s1", "Acme", null), collected());
    const written = await applyDirectWrites(db as never, "s1", w);
    expect(written.map((x) => x.field)).toEqual(["founded_year"]);
    expect(calls).toEqual(["update startups founded_year", "provenance profile.founded_year registry", "update startups country", "update startups enriched_v2_at"]);
  });
});

const outcome = (o: Partial<WriteOutcome> = {}): WriteOutcome => ({
  anyWrite: true, patch: {}, roundInserts: [], roundUpdates: [], headcountPoints: [], tags: [], newsAdded: 0, competitorsAdded: 0, ...o,
});

describe("buildDiff — what the admin approves", () => {
  it("lists additions, changes, new list entries and rounds", () => {
    const row = { ...freshRow("s1", "Acme", "https://acme.ai"), country: "Israel", founders: [{ name: "Dana Levi" }] } as never;
    const d = buildDiff(row, outcome({
      patch: { description: "Builds agents.", country: "United Kingdom", sector_id: "uuid-1", founders: [{ name: "Dana Levi" }, { name: "Omer Katz" }], news: [{ title: "Acme raises", url: "u" }] },
      roundInserts: [{ round_type: "Seed", amount_raised: 8_000_000, announcement_date: "2025-05-10", lead_investor: "Sequoia", source_url: "https://pr" }] as never,
      roundUpdates: [{ id: "r1", round_type: "Pre-Seed", patch: { lead_investor: "YC" } }] as never,
      headcountPoints: [{ date: "2025-01-01", count: 20 }], tags: ["AI Agents"],
    }), "AI & ML");
    expect(d.fields).toEqual([
      { field: "description", from: null, to: "Builds agents." },
      { field: "country", from: "Israel", to: "United Kingdom" },
      { field: "sector", from: null, to: "AI & ML" },
    ]);
    expect(d.lists).toEqual([{ field: "founders", added: ["Omer Katz"] }, { field: "news", added: ["Acme raises"] }]);
    expect(d.rounds).toEqual({
      inserts: [{ round_type: "Seed", amount: 8_000_000, date: "2025-05-10", lead: "Sequoia", source_url: "https://pr" }],
      updates: [{ round_type: "Pre-Seed", changes: ["lead_investor"] }],
    });
    expect([d.headcount_points, d.tags, isEmptyDiff(d)]).toEqual([1, ["AI Agents"], false]);
  });
  it("nothing to add: an empty diff, no proposal", () => {
    expect(isEmptyDiff(buildDiff(freshRow("s1", "Acme", null), outcome(), null))).toBe(true);
  });
});

describe("runDeepen", () => {
  const check = { id: "c1", user_id: "u1", kind: "deepen", phase: "check", matched_startup_id: "s1", input: { name: "Acme" } } as unknown as CheckRow;
  const company: Company = { row: freshRow("s1", "Acme", "https://acme.ai"), rounds: [] };
  const deps = (over: Partial<DeepenDeps> = {}): DeepenDeps => ({
    loadCompany: vi.fn(async () => company),
    collect: vi.fn(async () => collected()),
    applyDirectWrites: vi.fn(async (_id, w) => w),
    dryRunWrite: vi.fn(async () => outcome({ patch: { description: "Builds agents." } })),
    investorFacts: vi.fn(async () => []),
    proposeUpdate: vi.fn(async () => {}),
    progress: () => {},
    ...over,
  });

  it("runs on the company's own row and rounds; writes the official fields; proposes the rest", async () => {
    const d = deps();
    const out = await runDeepen(check, d);
    expect(d.collect).toHaveBeenCalledWith(company, expect.any(Function));
    expect(out.status).toBe("done");
    const result = (out.patch.result as { deepen: { direct: Array<{ field: string }>; proposed: boolean } }).deepen;
    expect(result.direct.map((x) => x.field)).toEqual(["founded_year", "country"]);
    expect(result.proposed).toBe(true);
    expect(d.proposeUpdate).not.toHaveBeenCalled();   // only once the check is saved
    await out.after!();
    expect(d.proposeUpdate).toHaveBeenCalledWith("c1", "s1", expect.anything(), expect.objectContaining({ fields: [{ field: "description", from: null, to: "Builds agents." }] }));
  });
  it("nothing left for review: no proposal", async () => {
    const out = await runDeepen(check, deps({ dryRunWrite: vi.fn(async () => outcome()) }));
    expect(out.after).toBeUndefined();
  });
  it("nothing found: no_new_data, with the reason, nothing written", async () => {
    const d = deps({ collect: vi.fn(async () => ({ outcome: "no_change" }) as never) });
    const out = await runDeepen(check, d);
    expect(out.status).toBe("no_new_data");
    expect((out.patch.result as { note: string }).note).toContain("nothing newer");
    expect(d.applyDirectWrites).not.toHaveBeenCalled();
  });
  it("a company that left AlphaMap fails at once, without a retry", async () => {
    await expect(runDeepen(check, deps({ loadCompany: vi.fn(async () => null) }))).rejects.toThrow("no longer in AlphaMap");
  });
});
