/**
 * The partial wet run (owner, 2026-11-01), end to end with every external
 * dependency faked — the same harness as bulk_enrich_v2.smoke.test.ts, with
 * the REAL write gate: PILOT=true writes only the pilot's four fields (and
 * their provenance and field_changes), nothing else.
 *
 * (Harness copied from bulk_enrich_v2.smoke.test.ts:) every
 * external dependency faked (Serper/Jina/Tavily via fetch, Claude via the
 * SDK, Supabase via a recording query builder). Exercises the real
 * pipeline: entity filter with identity keywords, the three extraction
 * calls, the Stage 9 deep dive, evidence/grounding drops, round planning
 * against a round already on file, and every write the run makes.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type Call = { table: string; op: string; payload: unknown; filters: Array<[string, unknown]> };
const calls: Call[] = [];
const rpcCalls: string[] = [];

const tables: Record<string, unknown[]> = {
  sectors: [{ name: "Media", parent_id: null }, { name: "Publishing", parent_id: "p" }],
  startups: [{
    id: "st-1", name: "Ghost", website: "https://ghost.org", description: null, value_proposition: null, industry: null,
    founded_year: null, country: null, city: null, employee_count: null, employee_range: null, growth_trend: null,
    founders: null, leadership: null, acquisitions: null, news: null, patent_count: null, patent_fields: null,
    // Marked unverified by the legacy cleanup: Substack is verified by this run (its sourced entry replaces it), Medium stays as it is.
    competitors: [
      { name: "Substack", how_it_competes: "Newsletter platform.", website: null, startup_id: null, unverified: true },
      { name: "Medium", how_it_competes: "Blogging platform.", website: null, startup_id: null, unverified: true },
    ],
    patents: null, tech_stack: null, github_url: null, huggingface_url: null, arr_milestones: null, revenue_estimate: null,
    valuation_benchmarks: null, linkedin_url: null, facebook_url: null, instagram_url: null, sector_id: null,
    funding_history_complete: null, status: "active", last_enriched_at: null, is_manually_verified: false,
  }, {
    id: "st-ghia", name: "Ghia", website: "https://drinkghia.com", description: "Non-alcoholic aperitif brand.", value_proposition: null, industry: "Beverages",
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
    select: () => b, order: () => b, range: () => b, single: () => b,
    eq: (k: string, v: unknown) => { state.filters.push([k, v]); return b; },
    update: (p: unknown) => { state.op = "update"; state.payload = p; return b; },
    insert: (p: unknown) => { state.op = "insert"; state.payload = p; return b; },
    upsert: (p: unknown) => { state.op = "upsert"; state.payload = p; return b; },
    delete: () => { state.op = "delete"; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      calls.push({ ...state });
      // An insert answers with its new row's id (and enrichment_runs with its run_id), as .insert().select().single() does.
      const data = state.op === "select" ? (tables[table] ?? []) : state.op === "insert" ? { id: `${table}-new`, run_id: "run-test" } : null;
      return Promise.resolve({ data, error: null }).then(res, rej);
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
// The REAL write gate (writeGate.ts) decides here: a pilot is the one write it allows before Phase 1.

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

describe("PILOT=true: only HQ, founded year and founding country are written (owner, 2026-11-01)", () => {
  beforeAll(async () => {
    process.env.DRY_RUN = "false";
    process.env.PILOT = "true";
    process.env.ONLY = "st-1";
    process.env.PILOT_REPORT = "/tmp/pilot_report_test.csv";
    // The four fields open by the owner's review (≥20 marked, ≥90% correct — fieldReview.ts).
    const tracker = join(mkdtempSync(join(tmpdir(), "review-")), "tracker.csv");
    writeFileSync(tracker, ["id,field,company,value,source_url,verdict,source_of_mark",
      ...["hq_city", "hq_country", "founded_year", "founding_country"].flatMap((f) => Array.from({ length: 20 }, (_, i) => `${f}.${i},${f},Co,v,,correct,test`))].join("\n"));
    process.env.FIELD_REVIEW_TRACKER = tracker;
    process.env.BATCH_DIR = join(mkdtempSync(join(tmpdir(), "out-")), "field_review");
    process.env.SEARCH_CACHE = "false";
    process.env.DELAY_MS = "0";
    process.env.REFRESH_EVERY = "1";
    process.env.SERP_KEY = "test";
    process.env.TAVILY_API_KEY = "test";
    vi.stubGlobal("fetch", fakeFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { main } = await import("./bulk_enrich_v2.ts");
    await main();
  }, 30_000);

  it("patches startups with pilot fields only", () => {
    const updates = calls.filter((c) => c.table === "startups" && c.op === "update").map((c) => Object.keys(c.payload as object));
    expect(updates.length).toBeGreaterThan(0);
    for (const keys of updates) expect(keys.every((k) => ["city", "country", "founded_year", "founding_country"].includes(k))).toBe(true);
    expect(updates.flat()).toContain("city");
  });

  it("writes no rounds, tags, headcount, hints, score, timestamps or domain notes", () => {
    const writes = calls.filter((c) => c.op !== "select").map((c) => c.table);
    expect(new Set(writes)).toEqual(new Set(["enrichment_runs", "startups", "field_changes", "field_provenance"]));
    expect(rpcCalls.filter((r) => r !== "sector_id_by_name" && r !== "refresh_startups_search")).toEqual([]);
  });

  it("records provenance only for the pilot's fields", () => {
    const fields = calls.filter((c) => c.table === "field_provenance" && c.op === "insert").map((c) => (c.payload as { field: string }).field);
    expect(fields.every((f) => ["profile.city", "profile.country", "profile.founded_year", "profile.founding_country"].includes(f))).toBe(true);
  });
});
