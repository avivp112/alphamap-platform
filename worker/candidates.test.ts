import { describe, it, expect } from "vitest";
import { parseDescription, candidateBatch } from "./candidates.ts";

describe("parseDescription", () => {
  it("reads the JSON answer, even inside prose or a code fence", () => {
    expect(parseDescription('```json\n{"quote":"We build drones.","description_he":"בונה רחפנים"}\n```')).toEqual({ quote: "We build drones.", description_he: "בונה רחפנים" });
  });
  it("null quote, missing fields and garbage give null", () => {
    expect(parseDescription('{"quote":null,"description_he":null}')).toBeNull();
    expect(parseDescription('{"quote":"x"}')).toBeNull();
    expect(parseDescription("no json here")).toBeNull();
    expect(parseDescription('{"quote":"","description_he":"x"}')).toBeNull();
  });
});

describe("candidateBatch", () => {
  const rows = [{ id: "1", source: "sec_form_d", name: "Lumen Quantum, Inc.", country: "US", founded_year: 2025, entity_number: null, website: null, evidence: {} }];
  const chain = (data: unknown, rpcs: Array<{ fn: string; args: unknown }>) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "filter", "order", "is", "update"]) q[m] = () => q;
    q.limit = async () => ({ data, error: null });
    return { from: () => q, rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { error: null }; } };
  };
  const search = async () => ({ organic: [], knowledgeGraph: null });
  const deps = (rpcs: Array<{ fn: string; args: unknown }>) => ({
    db: chain(rows, rpcs) as never, search, fetch: (async () => new Response("")) as typeof fetch,
    describe: async () => null, log: () => {},
  });

  it("dry run: looks, reports, writes nothing", async () => {
    const rpcs: Array<{ fn: string; args: unknown }> = [];
    const r = await candidateBatch(deps(rpcs), { limit: 5, write: false });
    expect(r).toMatchObject({ checked: 1, no_site: 1, wrote: false });
    expect(rpcs).toEqual([]);
  });
  it("write mode saves the enrichment on the candidate", async () => {
    const rpcs: Array<{ fn: string; args: unknown }> = [];
    await candidateBatch(deps(rpcs), { limit: 5, write: true });
    expect(rpcs.map((x) => x.fn)).toEqual(["merge_candidate_evidence"]);
    expect((rpcs[0].args as { p_extra: { enrichment: { status: string } } }).p_extra.enrichment.status).toBe("no_site");
  });
  it("a rejected search key stops the batch", async () => {
    const many = [...rows, { ...rows[0], id: "2", name: "Other Co" }];
    const r = await candidateBatch({ ...deps([]), db: chain(many, []) as never, search: async () => { throw new Error("ProviderKeyError Serper HTTP 403"); } }, { limit: 5, write: false });
    expect(r.failed).toBe(1);
    expect(r.checked).toBe(0);
  });
});
