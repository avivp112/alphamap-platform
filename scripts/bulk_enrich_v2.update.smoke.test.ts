/**
 * End-to-end test of MODE=update with every external dependency faked.
 *
 *   - Ghost: checked 100 days ago; the news search now returns one article
 *     already on file, one new Series A announcement and one new CEO
 *     appointment. The update adds the Series A as a new round (so total
 *     raised grows), leaves the Seed on file untouched, keeps the old CEO
 *     as "Former CEO", and does not touch funding_history_complete.
 *   - Quiet Co: checked 100 days ago, nothing new — no Claude call at all,
 *     only last_enriched_at is stamped.
 *   - Fresh Co: checked 5 days ago — not due, never processed.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown]> };
const calls: Call[] = [];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const baseRow = {
  value_proposition: null, industry: "Software", employee_count: 60, employee_range: null, growth_trend: null,
  competitors: null, acquisitions: null, patent_count: null, patent_fields: null, patents: null, tech_stack: null,
  github_url: null, huggingface_url: null, arr_milestones: null, revenue_estimate: null, valuation_benchmarks: null,
  linkedin_url: null, facebook_url: null, instagram_url: null, sector_id: "sec-1", status: "active", is_manually_verified: false,
  founded_year: 2013, country: "United Kingdom", city: "London",
};

const tables: Record<string, unknown[]> = {
  sectors: [{ id: "p", name: "Media", parent_id: null }],
  startups: [
    {
      ...baseRow, id: "st-ghost", name: "Ghost", website: "https://ghost.org", description: "Open source publishing platform.",
      founders: [{ name: "John O'Nolan", title: "Founder" }],
      leadership: [{ name: "John O'Nolan", role: "CEO" }],
      news: [{ title: "Ghost joins the fediverse", url: "https://www.theverge.com/2024/ghost-activitypub", published_date: "2024-03-01" }],
      funding_history_complete: true, last_enriched_at: daysAgo(100),
    },
    {
      ...baseRow, id: "st-quiet", name: "Quiet Co", website: "https://quietco.io", description: "Accounting software.",
      founders: [{ name: "Ann Lee", title: "Founder" }], leadership: null, news: null,
      funding_history_complete: null, last_enriched_at: daysAgo(100),
    },
    {
      ...baseRow, id: "st-fresh", name: "Fresh Co", website: "https://freshco.io", description: "Payroll software.",
      founders: [{ name: "Bo Kim", title: "Founder" }], leadership: null, news: null,
      funding_history_complete: null, last_enriched_at: daysAgo(5),
    },
  ],
  funding_rounds: [{
    id: "r-seed", startup_id: "st-ghost", round_type: "Seed", amount_raised: 2_000_000, valuation: null, is_valuation_estimated: null,
    announcement_date: "2014-03-15", source_url: "https://techcrunch.com/2014/03/15/ghost-raises-seed", lead_investor: "Y Combinator",
    investors: null, investor_amounts: null,
  }],
  field_provenance: [],
};

function builder(table: string) {
  const state: Call = { table, op: "select", payload: null, filters: [] };
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, range: () => b, limit: () => b, not: () => b, is: () => b,
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return b; },
    update: (p: unknown) => { state.op = "update"; state.payload = p; return b; },
    insert: (p: unknown) => { state.op = "insert"; state.payload = p; return b; },
    upsert: (p: unknown) => { state.op = "upsert"; state.payload = p; return b; },
    delete: () => { state.op = "delete"; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      calls.push({ ...state });
      const rows = (tables[table] ?? []).filter((r) => state.filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v || k === "id"));
      return Promise.resolve({ data: state.op === "select" ? rows : null, error: null }).then(res, rej);
    },
  };
  return b;
}

const fakeSupabase = {
  from: (t: string) => builder(t),
  rpc: async (name: string) => {
    if (name === "sector_id_by_name") return { data: "sec-1", error: null };
    return { data: null, error: null };
  },
};
vi.mock("./bulk_enrich_all.ts", () => ({ initV1Context: async () => {}, supabase: fakeSupabase }));

const SERIES_A = "Ghost (ghost.org), the open source publishing platform, raised a $10 million Series A led by Accel.";
const NEW_CEO = "Ghost (ghost.org) appointed Jane Roe as CEO; founder John O'Nolan becomes chair.";

const serperQueries: string[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://google.serper.dev/search" || url === "https://google.serper.dev/news") {
    const q = JSON.parse(String(init?.body)).q as string;
    serperQueries.push(q);
    if (!q.includes('"Ghost"')) return json({ organic: [], news: [] });
    const items = [
      { link: "https://www.theverge.com/2024/ghost-activitypub", title: "Ghost joins the fediverse", snippet: "Ghost (ghost.org) adds ActivityPub.", date: "Mar 1, 2024", source: "The Verge" },
      { link: "https://techcrunch.com/2026/09/01/ghost-series-a", title: "Ghost raises $10M Series A", snippet: SERIES_A, date: "Sep 1, 2026", source: "TechCrunch" },
      { link: "https://www.niemanlab.org/2026/ghost-new-ceo", title: "Ghost names Jane Roe CEO", snippet: NEW_CEO, date: "Sep 10, 2026", source: "Nieman Lab" },
    ];
    return json(url.endsWith("/news") ? { news: items } : { organic: items });
  }
  return new Response("", { status: 404 });
});

function sid(prompt: string, urlPart: string): string | undefined {
  for (const m of prompt.matchAll(/\[([SW]\d+)\] (\S+)/g)) if (m[2].includes(urlPart)) return m[1];
  return undefined;
}

const createMock = vi.fn(async (req: { tools: Array<{ name: string }>; messages: Array<{ content: string }> }) => {
  const system = (req as { system?: Array<{ text: string }> }).system ?? [];
  const prompt = [...system.map((b) => b.text), req.messages[0].content].join("\n");
  const tool = (req as { tool_choice?: { name?: string } }).tool_choice?.name ?? req.tools[0].name;
  const a = sid(prompt, "ghost-series-a");
  let input: Record<string, unknown> = {};
  if (tool === "save_profile_extraction") {
    input = {
      is_public_company: false, is_tech_company: false, // an update never rejects on this
      profile: {},
      leadership: [{ name: "Jane Roe", role: "CEO", bio: "Jane Roe was appointed CEO of Ghost." }],
      metrics: {},
    };
  } else if (tool === "save_funding_extraction") {
    input = {
      funding_history_complete: false,
      funding_rounds: a ? [{
        round_type: "Series A",
        amount_raised: { value: 10_000_000, source_id: a, evidence_quote: "raised a $10 million Series A led by Accel" },
        lead_investor: { value: "Accel", source_id: a, evidence_quote: "raised a $10 million Series A led by Accel" },
      }] : [],
    };
  } else if (tool === "save_market_extraction") {
    input = { competitors: [], news: [{ title: "Ghost raises $10M Series A", url: "https://techcrunch.com/2026/09/01/ghost-series-a", source: "TechCrunch" }] };
  }
  return { content: [{ type: "tool_use", id: "t", name: tool, input }], stop_reason: "tool_use", usage: { input_tokens: 500, output_tokens: 100 } };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: createMock }; } }));

describe("bulk_enrich_v2 MODE=update end to end (all I/O faked)", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      MODE: "update", DRY_RUN: "false", SEARCH_CACHE: "false", DELAY_MS: "0", REFRESH_EVERY: "0",
      SERP_KEY: "test", TAVILY_API_KEY: "test", SEEN_URLS_DIR: mkdtempSync(join(tmpdir(), "seen-")),
    });
    vi.stubGlobal("fetch", fakeFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { main } = await import("./bulk_enrich_v2.ts");
    await main();
  }, 30_000);

  const updatesOf = (id: string) => calls.filter((c) => c.table === "startups" && c.op === "update" && c.filters.some(([k, v]) => k === "id" && v === id));

  it("never processes a company checked 5 days ago", () => {
    expect(updatesOf("st-fresh")).toHaveLength(0);
    expect(serperQueries.some((q) => q.includes("Fresh Co"))).toBe(false);
  });

  it("searches only for what is new since the last check", () => {
    expect(serperQueries.filter((q) => q.includes('"Ghost"')).every((q) => /after:\d{4}-\d{2}-\d{2}/.test(q) || q.startsWith("site:linkedin.com"))).toBe(true);
  });

  it("adds the newly announced round as a new row and leaves the round on file untouched", () => {
    const inserts = calls.filter((c) => c.table === "funding_rounds" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({ round_type: "Series A", amount_raised: 10_000_000, lead_investor: "Accel" });
    expect(calls.some((c) => c.table === "funding_rounds" && c.op === "update")).toBe(false);
  });

  it("keeps the previous CEO as 'Former CEO' next to the newly appointed one, and never flips funding_history_complete", () => {
    const patch = updatesOf("st-ghost").map((c) => c.payload as Record<string, unknown>).find((p) => p.leadership);
    const leadership = patch?.leadership as Array<{ name: string; role: string }>;
    expect(leadership).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "John O'Nolan", role: "Former CEO" }),
      expect.objectContaining({ name: "Jane Roe", role: "CEO" }),
    ]));
    expect(updatesOf("st-ghost").some((c) => "funding_history_complete" in (c.payload as object))).toBe(false);
  });

  it("does not re-add news already on file, and sends no already-known page to Claude", () => {
    const prompts = createMock.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(prompts.every((p) => !p.includes("ghost-activitypub"))).toBe(true);
  });

  it("makes no Claude call at all for a company with nothing new, and only stamps it as checked", () => {
    const prompts = createMock.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(prompts.some((p) => p.includes("Quiet Co"))).toBe(false);
    const quiet = updatesOf("st-quiet").map((c) => Object.keys(c.payload as object));
    expect(quiet).toEqual([["last_enriched_at"]]);
  });
});
