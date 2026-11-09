/**
 * The promotion write gate, end to end (owner, 2026-11-09): with PHASE1_PASSED true, worker/promote.ts writes only the fields the
 * tracker has opened — the same gate as bulk_enrich_v2. Nothing here is mocked inside the library: the REAL collection
 * (worker/enrich.ts → lib/enrichment/collect.ts) runs on a fake web and a fake Claude, the result goes through serializeCollected
 * exactly as a user's check is stored, and promoteOne writes it with the REAL writeCollected into a recording database.
 * (The fake web and fake Claude are those of scripts/bulk_enrich_v2.pilot.smoke.test.ts.)
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown]> };
let calls: Call[] = [];
let rpcs: string[] = [];

const tables: Record<string, unknown[]> = {
  sectors: [{ id: "p", name: "Media", parent_id: null }, { id: "c", name: "Publishing", parent_id: "p" }],
  startups: [{ id: "other-1", name: "Other Co", website: "https://other.example" }],
  funding_rounds: [],
};

function builder(table: string) {
  const state: Call = { table, op: "select", payload: null, filters: [] };
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, range: () => b, single: () => b, not: () => b, neq: () => b, in: () => b, is: () => b,
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return b; },
    update: (p: unknown) => { state.op = "update"; state.payload = p; return b; },
    insert: (p: unknown) => { state.op = "insert"; state.payload = p; return b; },
    upsert: (p: unknown) => { state.op = "upsert"; state.payload = p; return b; },
    delete: () => { state.op = "delete"; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      calls.push({ ...state });
      const data = state.op === "select" ? (tables[table] ?? []) : state.op === "insert" ? { id: `${table}-new`, run_id: "run-test" } : null;
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return b;
}

const fakeDb = {
  from: (t: string) => builder(t),
  rpc: async (name: string) => {
    rpcs.push(name);
    if (name === "sector_id_by_name") return { data: "sec-1", error: null };
    if (name === "calculate_alphamap_score") return { data: { score: 55, tier: "B" }, error: null };
    if (name === "claim_check_promotion") return { data: null, error: null };
    if (name === "start_check_promotion_write") return { data: "st-new", error: null };
    return { data: null, error: null };
  },
};

// ── Fake web ────────────────────────────────────────────────────────────
const SITE = "Ghost is an independent open source publishing platform for newsletters and paid membership subscriptions. Creators use Ghost publishing to run newsletters and grow membership revenue. Founded in 2013 by John O'Nolan and Hannah Wolfe. Ghost publishing powers thousands of newsletters with membership and subscriptions built in.";

function serperResults(q: string) {
  const r = (link: string, title: string, snippet: string) => ({ link, title, snippet });
  if (q.startsWith("site:linkedin.com/in")) {
    return [
      r("https://uk.linkedin.com/in/johnonolan?trk=public", "John O'Nolan - Ghost | LinkedIn", "Founder & CEO at Ghost (ghost.org). · Experience: WordPress · Education: Stanford University"),
      r("https://www.linkedin.com/in/john-onolan-plumber", "John Nolan - Ghost Plumbing | LinkedIn", "Owner"),
    ];
  }
  if (q.includes("employees team size headquarters")) {
    return [r("https://ghost.org/about/press/", "Ghost press", "Ghost (ghost.org) is headquartered in London, United Kingdom, and runs as a non-profit foundation.")];   // the HQ the company itself declares (owner, 2026-11-01)
  }
  if (q.includes("competitors") || q.includes("alternatives") || q.includes(" vs")) {
    return [
      r("https://zapier.com/blog/ghost-alternatives", "Best Ghost alternatives", "Top alternatives to Ghost (ghost.org) for newsletters: Substack, Medium and Beehiiv both offer paid newsletters and membership."),
      r("https://www.niemanlab.org/2025/ghost-newsletters", "Ghost bets on paid newsletters", "Ghost (ghost.org) competes with Substack and Beehiiv for paid newsletters and membership."),
    ];
  }
  return [
    r("https://techcrunch.com/2014/03/15/ghost-raises-seed", "Ghost raises $2M", "Ghost (ghost.org), the 10-person publishing startup, raised a $2 million seed round led by Y Combinator with SV Angel participating. Ghost now powers 70,000 publishers."),
    r("https://www.linkedin.com/company/ghost-foundation", "Ghost | LinkedIn", "Ghost (ghost.org) open source publishing platform. Ghost has 60 employees."),
    r("https://techcrunch.com/ghost-robotics-raises", "Ghost Robotics raises $100M", "Ghost Robotics builds legged quadruped robots for defense."),
  ];
}

function newsResults() {
  return [
    { link: "https://www.theverge.com/2024/ghost-activitypub", title: "Ghost joins the fediverse", snippet: "Ghost, the open source newsletter and publishing platform, adds ActivityPub.", date: "Mar 1, 2024", source: "The Verge" },
    { link: "https://www.niemanlab.org/2025/ghost-6", title: "Ghost 6.0 launches", snippet: "Ghost launches version 6 for newsletters and membership publishing.", date: "Aug 5, 2025", source: "Nieman Lab" },
  ];
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://google.serper.dev/search") return json({ organic: serperResults(JSON.parse(String(init?.body)).q) });
  if (url === "https://google.serper.dev/news") return json({ news: newsResults() });
  if (url.startsWith("https://api.tavily.com")) return json({ results: [] });
  if (url.startsWith("https://r.jina.ai/")) {
    return url.endsWith("ghost.org") ? new Response(SITE, { status: 200 }) : new Response("", { status: 404 });
  }
  if (url.includes("theverge.com") || url.includes("niemanlab.org")) {
    // A real page carries its own headline: a short or cut headline is confirmed against it (newsGate.ts).
    const pageTitle = url.includes("ghost-activitypub") ? "Ghost joins the fediverse | The Verge" : url.includes("ghost-6") ? "Ghost 6.0 launches | Nieman Lab" : "";
    return new Response(`<html><head><meta property="og:image" content="/img/hero.jpg">${pageTitle ? `<meta property="og:title" content="${pageTitle}">` : ""}</head></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("", { status: 404 });
});

// ── Fake Claude ─────────────────────────────────────────────────────────
function sid(prompt: string, urlPart: string): string | undefined {
  for (const m of prompt.matchAll(/\[([SW]\d+)\] (\S+)/g)) if (m[2].includes(urlPart)) return m[1];
  return undefined;
}

const createMock = vi.fn(async (req: { tools: Array<{ name: string }>; messages: Array<{ content: string }> }) => {
  const system = (req as { system?: Array<{ text: string }> }).system ?? [];
  const prompt = [...system.map((b) => b.text), req.messages[0].content].join("\n");
  const tool = (req as { tool_choice?: { name?: string } }).tool_choice?.name ?? req.tools[0].name;
  let input: Record<string, unknown> = {};
  const tc = sid(prompt, "ghost-raises-seed");
  const w1 = sid(prompt, "ghost.org");
  const li = sid(prompt, "linkedin.com/company");
  const hq = sid(prompt, "ghost.org/about/press");

  if (tool === "classify_company") {
    input = prompt.includes('"Ghia"')
      ? { is_tech_company: false, confidence: "high", reason: "a non-alcoholic beverage brand" }
      : { is_tech_company: true, confidence: "high", reason: "publishing software" };
  } else if (tool === "save_profile_extraction") {
    input = {
      is_public_company: false, is_tech_company: true,
      profile: {
        description: "Open source publishing platform for newsletters and memberships.",
        sector_name: "Media", sub_sector_name: "Publishing",
        ...(w1 ? {
          founded_year: { value: 2013, source_id: w1, evidence_quote: "Founded in 2013 by John O'Nolan and Hannah Wolfe" },
          founders: [{ name: "John O'Nolan", title: "CEO" }, { name: "Hannah Wolfe", title: "COO" }],
        } : {}),
        ...(hq ? {
          city: { value: "London", source_id: hq, evidence_quote: "Ghost (ghost.org) is headquartered in London, United Kingdom" },
          country: { value: "United Kingdom", source_id: hq, evidence_quote: "Ghost (ghost.org) is headquartered in London, United Kingdom" },
        } : {}),
      },
      leadership: [],
      metrics: {
        ...(li ? { employee_count: { value: 60, source_id: li, evidence_quote: "Ghost has 60 employees" } } : {}),
        ...(tc ? { headcount_history: [
          { date: "2014-03-15", employee_count: 10, source_id: tc, evidence_quote: "the 10-person publishing startup" },
          { date: "2024-10-15", employee_count: 70000, source_id: tc, evidence_quote: "Ghost now powers 70,000 publishers" },
        ] } : {}),
      },
    };
  } else if (tool === "save_funding_extraction") {
    input = {
      funding_history_complete: true,
      funding_rounds: tc ? [
        {
          round_type: "Seed",
          amount_raised: { value: 2_000_000, source_id: tc, evidence_quote: "raised a $2 million seed round led by Y Combinator" },
          lead_investor: { value: "Y Combinator", source_id: tc, evidence_quote: "raised a $2 million seed round led by Y Combinator" },
          other_investors: ["SV Angel", "Made Up Capital"],
          source_url: "https://example.com/guessed",
        },
        { round_type: "Series A", amount_raised: { value: 9_000_000, source_id: tc, evidence_quote: "a sentence that is not in the source" } },
      ] : [],
    };
  } else if (tool === "save_market_extraction") {
    const zap = sid(prompt, "zapier.com");
    const nl = sid(prompt, "niemanlab.org/2025/ghost-newsletters");
    const said = "Ghost (ghost.org) competes with Substack and Beehiiv for paid newsletters";
    input = {
      competitors: zap && nl ? [
        { name: "Substack", how_it_competes: "Paid newsletter platform.", source_ids: [nl], source_id: nl, evidence_quote: said },
        { name: "Beehiiv", how_it_competes: "Newsletter platform.", source_ids: [nl], source_id: nl, evidence_quote: said },
        // Named only on an "alternatives" list: not a competitor (competitorEvidence.ts).
        { name: "Medium", how_it_competes: "Blogging platform.", source_ids: [zap], source_id: zap, evidence_quote: "Top alternatives to Ghost (ghost.org) for newsletters: Substack, Medium" },
      ] : [],
      news: [
        { title: "Ghost joins the fediverse", url: "https://www.theverge.com/2024/ghost-activitypub", source: "The Verge", published_date: "2024-03-01" },
        { title: "Ghost 6.0 launches", url: "https://www.niemanlab.org/2025/ghost-6", source: "Nieman Lab", published_date: "2025-08-05" },
        { title: "Invented", url: "https://made-up.com/ghost" },
      ].filter((n) => prompt.includes(n.url) || n.url.includes("made-up")),
    };
  }
  return {
    content: [{ type: "tool_use", id: "t", name: tool, input }],
    stop_reason: "tool_use", usage: { input_tokens: 1000, output_tokens: 200 },
  };
});

vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: createMock }; } }));

import { runEnrichment } from "./enrich";
import { promoteOne, serializeCollected, type PromotionJob } from "./promote";
import { openColumnsOf } from "../lib/enrichment/writeUnits";

let stored: PromotionJob["collected"];
beforeAll(async () => {
  process.env.SERP_KEY = "test";
  process.env.TAVILY_API_KEY = "test";
  process.env.SEARCH_CACHE = "false";
  process.env.DELAY_MS = "0";
  vi.stubGlobal("fetch", fakeFetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const meter = { searchCalls: 0, llmInputTokens: 0, llmOutputTokens: 0, llmCostUsd: 0 } as never;
  const result = await runEnrichment({ checkId: "chk-1", name: "Ghost", website: "https://ghost.org", country: null, founder: null },
    { anthropic: { messages: { create: createMock } } as never, model: "test-model", taxonomy: { parentNames: ["Media"], subNames: ["Publishing"] }, meter });
  if (result.outcome !== "collected") throw new Error(`collection did not run: ${result.outcome}`);
  stored = serializeCollected(result);
}, 60_000);

/** One approved company, written with the flag on and these fields open. Returns what reached the database. */
async function promoteWith(openFields: readonly string[]) {
  calls = []; rpcs = [];
  const job: PromotionJob = { id: "job-1", kind: "new", check_id: "chk-1", user_id: "u-1", name: "Ghost", website: "https://ghost.org", collected: stored };
  const db = { ...fakeDb, rpc: async (name: string, args?: unknown) => { rpcs.push(name); return name === "claim_check_promotion" ? { data: job, error: null } : fakeDb.rpc(name).then((r) => { rpcs.pop(); return r; }); } } as never;
  const logs: string[] = [];
  await promoteOne({ db, taxonomy: async () => ({ parentNames: ["Media"], subNames: ["Publishing"] }), findExisting: async () => null, notify: async () => {}, log: (m) => logs.push(m), phase1Passed: true, openFields });
  const writes = calls.filter((c) => c.op !== "select");
  const startupKeys = writes.filter((c) => c.table === "startups" && c.op === "update").flatMap((c) => Object.keys(c.payload as object));
  const changeRows = writes.filter((c) => c.table === "field_changes").flatMap((c) => (Array.isArray(c.payload) ? c.payload : [c.payload]) as Array<{ run_id?: string | null }>);
  return { writes, startupKeys, tablesWritten: new Set(writes.map((c) => c.table)), logs, changeRows };
}

// What a promotion writes besides the company's data, with or without a field open (owner, 2026-11-09): the same bookkeeping as a
// wide bulk_enrich_v2 run (a pilot skips it) — the company is stamped as enriched and listed (enriched_v2_at, migration 20261010000000)
// and its score is snapshotted. Pinned here: a new column or table in this list is a decision, not an accident.
const BOOKKEEPING_COLUMNS = ["last_enriched_at", "enriched_v2_at"];   // enriched_v2_at only when the description was written (below)
const BOOKKEEPING_TABLES = ["field_changes", "field_provenance", "enrichment_runs", "alphamap_score_history"];

describe("past Phase 1, a promotion writes only the fields the tracker has opened", () => {
  it("only news open: the company's data columns are news and nothing else; no rounds, tags, headcount or hints", async () => {
    const r = await promoteWith(["news"]);
    const allowed = openColumnsOf(["news"]);
    expect(r.startupKeys).toContain("news");                          // not vacuous: the collection found news and it was written
    expect(r.startupKeys.filter((k) => !BOOKKEEPING_COLUMNS.includes(k)).every((k) => allowed.has(k))).toBe(true);
    expect([...r.tablesWritten].filter((t) => t !== "startups" && !BOOKKEEPING_TABLES.includes(t))).toEqual([]);
  });
  it("the four profile fields open: HQ and founded year are written, news and the rest are not", async () => {
    const open = ["hq_city", "hq_country", "founded_year", "founding_country"];
    const r = await promoteWith(open);
    const allowed = openColumnsOf(open);
    expect(r.startupKeys).toContain("city");
    expect(r.startupKeys.filter((k) => !BOOKKEEPING_COLUMNS.includes(k)).every((k) => allowed.has(k))).toBe(true);
    expect(r.startupKeys).not.toContain("news");
    expect([...r.tablesWritten].filter((t) => t !== "startups" && !BOOKKEEPING_TABLES.includes(t))).toEqual([]);
  });
  it("nothing open: no data column of the company is written, only the bookkeeping", async () => {
    const r = await promoteWith([]);
    expect(r.startupKeys.filter((k) => !BOOKKEEPING_COLUMNS.includes(k))).toEqual([]);
    expect([...r.tablesWritten].filter((t) => t !== "startups" && !BOOKKEEPING_TABLES.includes(t))).toEqual([]);
  });
  it("every change a promotion records carries its run_id, so it can be undone (RUN_ID=… npx tsx scripts/undo_run.ts)", async () => {
    const r = await promoteWith(["news"]);
    expect(r.changeRows.length).toBeGreaterThan(0);
    expect(r.changeRows.every((c) => c.run_id === "run-test")).toBe(true);
    expect(r.writes.some((c) => c.table === "enrichment_runs" && c.op === "insert")).toBe(true);
    expect(r.logs.some((l) => /run_id run-test — undo: RUN_ID=run-test/.test(l))).toBe(true);
  });
});

describe("the board is its own field: the leader field opening the leadership column does not write board members (owner, 2026-11-09)", () => {
  const leadershipWritten = (r: Awaited<ReturnType<typeof promoteWith>>) => {
    const u = r.writes.filter((c) => c.table === "startups" && c.op === "update").map((c) => c.payload as { leadership?: Array<{ name: string; role?: string; group?: string }> });
    return u.flatMap((p) => p.leadership ?? []);
  };
  const withPeople = () => {
    const s = stored as unknown as { profile: { leadership: unknown[] }; allSources: Array<{ source_id: string; source_type: string; url: string; title: string; query_label: string }> };
    s.allSources.push({ source_id: "S98", source_type: "news", url: "https://techcrunch.com/2014/03/15/ghost-raises-seed", title: "Ghost raises", query_label: "x" });
    s.profile.leadership = [
      { name: "Jane Roe", role: "CEO", bio_source_ids: ["S98"] },
      { name: "Victor Lazarte", role: "Board member", group: "board", bio_source_ids: ["S98"] },
    ];
  };
  it("leader open, board not: the CEO is written, the board member is not", async () => {
    withPeople();
    const r = await promoteWith(["leader"]);
    const names = leadershipWritten(r).map((l) => l.name);
    expect(names).toContain("Jane Roe");
    expect(names).not.toContain("Victor Lazarte");
  });
  it("leader and board open: the board member is written, as group board", async () => {
    withPeople();
    const r = await promoteWith(["leader", "board"]);
    const board = leadershipWritten(r).find((l) => l.name === "Victor Lazarte");
    expect(board).toMatchObject({ role: "Board member", group: "board" });
  });
});

import { writeCollected, newWriteSummary, BULK_THRESHOLDS } from "../lib/enrichment/writeCompany";
import { deserializeCollected, freshRow } from "./promote";

describe("a competitor in the batch report comes with the sentence that says they compete (wet batch 3, 2026-11-09)", () => {
  it("competitor_declared lines carry the evidence quote and its source", async () => {
    calls = []; rpcs = [];
    const s = stored as unknown as { market: { competitors: unknown[] }; allSources: Array<Record<string, string>> };
    s.allSources.push({ source_id: "S97", source_type: "company_site", url: "https://ghost.org/vs/substack", title: "Ghost vs Substack", query_label: "vs" });
    s.market.competitors = [{ name: "Substack", how_it_competes: "Paid newsletter platform.", source_ids: ["S97"], source_id: "S97", evidence_quote: "Ghost competes with Substack for paid newsletters", tier: "declared" }];
    const out = await writeCollected(freshRow("st-q", "Ghost", "https://ghost.org"), deserializeCollected(stored), {
      db: fakeDb as never, dryRun: true, update: false, verbose: false, thresholds: BULK_THRESHOLDS, openFields: ["competitor_declared"],
      taxonomy: { parentNames: ["Media"], subNames: ["Publishing"] }, startupByDomain: new Map(), seen: null,
    }, newWriteSummary());
    const lines = (out.pilot ?? []).filter((l) => l.field === "competitor_declared");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.source_url).toBeTruthy();
      expect(l.quote).toMatch(/compete/i);
    }
  });
});

describe("enriched_v2_at — the Private Market stamp — only when the description was written (owner, 2026-11-09)", () => {
  it("news open, no description: the company is not stamped, so v2 puts no company on the Private Market for a news item", async () => {
    const r = await promoteWith(["news"]);
    expect(r.startupKeys).toContain("news");
    expect(r.startupKeys).not.toContain("enriched_v2_at");
  });
  it("description open and written: the company is stamped", async () => {
    // The collection's own description builder wrote none on the fake web (no verified "what" and "for whom"): one is given.
    const s = stored as unknown as { profile: { profile: { description?: string } } };
    const keep = s.profile.profile.description;
    s.profile.profile.description = "Ghost provides an open source publishing platform for newsletters and paid memberships.";
    try {
      const r = await promoteWith(["description", "news"]);
      expect(r.startupKeys).toContain("description");
      expect(r.startupKeys).toContain("enriched_v2_at");
    } finally { s.profile.profile.description = keep; }
  });
  it("description open but nothing written for it: not stamped", async () => {
    const s = stored as unknown as { profile: { profile: { description?: string } } };
    const keep = s.profile.profile.description;
    s.profile.profile.description = undefined;
    try {
      const r = await promoteWith(["description"]);
      expect(r.startupKeys).not.toContain("description");
      expect(r.startupKeys).not.toContain("enriched_v2_at");
    } finally { s.profile.profile.description = keep; }
  });
});
