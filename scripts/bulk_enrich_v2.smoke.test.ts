/**
 * End-to-end smoke test of scripts/bulk_enrich_v2.ts's main() with every
 * external dependency faked (Serper/Jina/Tavily via fetch, Claude via the
 * SDK, Supabase via a recording query builder). Exercises the real
 * pipeline: entity filter with identity keywords, the three extraction
 * calls, the Stage 9 deep dive, evidence/grounding drops, round planning
 * against a round already on file, and every write the run makes.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown]> };
const calls: Call[] = [];
const rpcCalls: string[] = [];

const tables: Record<string, unknown[]> = {
  sectors: [{ name: "Media", parent_id: null }, { name: "Publishing", parent_id: "p" }],
  startups: [{
    id: "st-1", name: "Ghost", website: "https://ghost.org", description: null, value_proposition: null, industry: null,
    founded_year: null, country: null, city: null, employee_count: null, employee_range: null, growth_trend: null,
    founders: null, leadership: null, competitors: null, acquisitions: null, news: null, patent_count: null, patent_fields: null,
    patents: null, tech_stack: null, github_url: null, huggingface_url: null, arr_milestones: null, revenue_estimate: null,
    valuation_benchmarks: null, linkedin_url: null, facebook_url: null, instagram_url: null, sector_id: null,
    funding_history_complete: null, status: "active", last_enriched_at: null, is_manually_verified: false,
  }],
  funding_rounds: [{
    id: "r-1", startup_id: "st-1", round_type: "Seed", amount_raised: 2_000_000, valuation: null, is_valuation_estimated: null,
    announcement_date: "2014-01-01", source_url: null, lead_investor: null, investors: null, investor_amounts: null,
  }],
};

function builder(table: string) {
  const state: Call = { table, op: "select", payload: null, filters: [] };
  const b: Record<string, unknown> = {
    select: () => b, order: () => b, range: () => b,
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return b; },
    update: (p: unknown) => { state.op = "update"; state.payload = p; return b; },
    insert: (p: unknown) => { state.op = "insert"; state.payload = p; return b; },
    upsert: (p: unknown) => { state.op = "upsert"; state.payload = p; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      calls.push({ ...state });
      return Promise.resolve({ data: state.op === "select" ? (tables[table] ?? []) : null, error: null }).then(res, rej);
    },
  };
  return b;
}

const fakeSupabase = {
  from: (t: string) => builder(t),
  rpc: async (name: string) => {
    rpcCalls.push(name);
    if (name === "sector_id_by_name") return { data: "sec-1", error: null };
    if (name === "calculate_alphamap_score") return { data: { score: 55, tier: "B" }, error: null };
    return { data: null, error: null };
  },
};

vi.mock("./bulk_enrich_all.ts", () => ({ initV1Context: async () => {}, supabase: fakeSupabase }));

// ── Fake web ────────────────────────────────────────────────────────────
const SITE = "Ghost is an independent open source publishing platform for newsletters and paid membership subscriptions. Creators use Ghost publishing to run newsletters and grow membership revenue. Founded in 2013 by John O'Nolan and Hannah Wolfe. Ghost publishing powers thousands of newsletters with membership and subscriptions built in.";

function serperResults(q: string) {
  const r = (link: string, title: string, snippet: string) => ({ link, title, snippet });
  if (q.startsWith("site:linkedin.com/in")) {
    return [
      r("https://uk.linkedin.com/in/johnonolan?trk=public", "John O'Nolan - Ghost | LinkedIn", "Founder & CEO at Ghost (ghost.org)."),
      r("https://www.linkedin.com/in/john-onolan-plumber", "John Nolan - Ghost Plumbing | LinkedIn", "Owner"),
    ];
  }
  if (q.includes("employees team size headquarters")) {
    return [r("https://sifted.eu/articles/ghost-profile", "Inside Ghost", "Ghost (ghost.org) is headquartered in London, United Kingdom, and runs as a non-profit foundation.")];
  }
  if (q.includes("competitors") || q.includes("alternatives") || q.includes(" vs")) {
    return [r("https://zapier.com/blog/ghost-alternatives", "Best Ghost alternatives", "Top alternatives to Ghost (ghost.org) for newsletters: Substack and Beehiiv both offer paid newsletters and membership.")];
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
    return new Response(`<html><head><meta property="og:image" content="/img/hero.jpg"></head></html>`, { status: 200, headers: { "content-type": "text/html" } });
  }
  return new Response("", { status: 404 });
});

// ── Fake Claude ─────────────────────────────────────────────────────────
function sid(prompt: string, urlPart: string): string | undefined {
  for (const m of prompt.matchAll(/\[([SW]\d+)\] (\S+)/g)) if (m[2].includes(urlPart)) return m[1];
  return undefined;
}

const createMock = vi.fn(async (req: { tools: Array<{ name: string }>; messages: Array<{ content: string }> }) => {
  const prompt = req.messages[0].content;
  const tool = req.tools[0].name;
  let input: Record<string, unknown> = {};
  const tc = sid(prompt, "ghost-raises-seed");
  const w1 = sid(prompt, "ghost.org");
  const li = sid(prompt, "linkedin.com/company");
  const hq = sid(prompt, "sifted.eu");

  if (tool === "save_profile_extraction") {
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
    input = {
      competitors: zap ? [
        { name: "Substack", how_it_competes: "Paid newsletter platform.", source_ids: [zap] },
        { name: "Beehiiv", how_it_competes: "Newsletter platform.", source_ids: [zap] },
        { name: "Medium", how_it_competes: "Not in any source.", source_ids: [zap] },
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

describe("bulk_enrich_v2 main() end to end (all I/O faked)", () => {
  beforeAll(async () => {
    process.env.DRY_RUN = "false";
    process.env.DELAY_MS = "0";
    process.env.SERP_KEY = "test";
    process.env.TAVILY_API_KEY = "test";
    vi.stubGlobal("fetch", fakeFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { main } = await import("./bulk_enrich_v2.ts");
    await main();
  }, 30_000);

  const startupPatch = () => calls.find((c) => c.table === "startups" && c.op === "update" && (c.payload as Record<string, unknown>).last_enriched_at === undefined)?.payload as Record<string, unknown>;

  it("runs all three extraction calls plus a deep-dive profile call", () => {
    const tools = createMock.mock.calls.map((c) => c[0].tools[0].name);
    expect(tools.filter((t) => t === "save_profile_extraction")).toHaveLength(2);
    expect(tools).toContain("save_funding_extraction");
    expect(tools).toContain("save_market_extraction");
  });

  it("writes overview, founders, headcount, and the deep-dive HQ", () => {
    const p = startupPatch();
    expect(p.founded_year).toBe(2013);
    expect((p.founders as Array<{ name: string }>).map((f) => f.name)).toEqual(["John O'Nolan", "Hannah Wolfe"]);
    expect(p.employee_count).toBe(60);
    expect(p.city).toBe("London");
    expect(p.country).toBe("United Kingdom");
    expect(p.sector_id).toBe("sec-1");
  });

  it("writes grounded competitors only, and news with og:image, newest first", () => {
    const p = startupPatch();
    expect((p.competitors as Array<{ name: string }>).map((c) => c.name)).toEqual(["Substack", "Beehiiv"]);
    const news = p.news as Array<{ url: string; image_url: string; published_date: string }>;
    expect(news.map((n) => n.url)).toEqual(["https://www.niemanlab.org/2025/ghost-6", "https://www.theverge.com/2024/ghost-activitypub"]);
    expect(news[0].image_url).toBe("https://www.niemanlab.org/img/hero.jpg");
  });

  it("fills the Seed round already on file instead of inserting a duplicate; drops the unevidenced Series A", () => {
    expect(calls.filter((c) => c.table === "funding_rounds" && c.op === "insert")).toHaveLength(0);
    const upd = calls.find((c) => c.table === "funding_rounds" && c.op === "update")!;
    expect(upd.filters).toContainEqual(["id", "r-1"]);
    expect(upd.payload).toEqual({
      lead_investor: "Y Combinator", investors: ["SV Angel"],
      source_url: "https://techcrunch.com/2014/03/15/ghost-raises-seed",
    });
  });

  it("records the dated historical headcount point with its own recorded_date, plus today's", () => {
    const hc = calls.filter((c) => c.table === "headcount_history").map((c) => c.payload as Record<string, unknown>);
    expect(hc[0]).toMatchObject({ employee_count: 10, snapshot_date: "2014-03-15", recorded_date: "2014-03-15T00:00:00Z" });
    expect(hc[1]).toMatchObject({ employee_count: 60 });
  });

  it("never records a non-employee number as headcount (the Gladia 70,000 point)", () => {
    const hc = calls.filter((c) => c.table === "headcount_history").map((c) => (c.payload as { employee_count: number }).employee_count);
    expect(hc).not.toContain(70000);
  });

  it("attaches the founder's personal LinkedIn /in/ profile, not a namesake's", () => {
    const founders = startupPatch().founders as Array<{ name: string; linkedin_url?: string }>;
    expect(founders.find((f) => f.name === "John O'Nolan")?.linkedin_url).toBe("https://www.linkedin.com/in/johnonolan");
    expect(founders.find((f) => f.name === "Hannah Wolfe")?.linkedin_url).toBeUndefined();
  });

  it("tags the sub-sector, writes provenance, refreshes startups_search", () => {
    expect(calls.some((c) => c.table === "startup_sub_sectors" && c.op === "upsert")).toBe(true);
    expect(calls.filter((c) => c.table === "field_provenance").length).toBeGreaterThan(0);
    expect(rpcCalls).toContain("refresh_startups_search");
  });

  it("never let the same-named Ghost Robotics article into any Claude prompt", () => {
    for (const c of createMock.mock.calls) expect(c[0].messages[0].content).not.toContain("ghost-robotics");
  });
});
