import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Provider order, owner's decision of 2026-10-20: Jina reads and Serper
// searches; Tavily only to go deeper or while Jina is down; no direct
// (cheerio) fetch of anyone's site. Each test loads the module fresh, since
// "Jina is down" is module state.
const ARTICLE = "Acme Robotics today announced a $20 million Series A led by Example Ventures. ".repeat(12);
type Mod = typeof import("./searchProviders");
async function fresh(): Promise<Mod> { vi.resetModules(); return import("./searchProviders"); }

const hosts = (m: ReturnType<typeof vi.fn>) => m.mock.calls.map((c) => new URL(String(c[0])).hostname);

function fakeFetch(opts: { jina: "ok" | "402" | ((url: string) => boolean); tavily?: Record<string, string> }) {
  return vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.startsWith("https://r.jina.ai/")) {
      const target = url.slice("https://r.jina.ai/".length);
      if (opts.jina === "402") return new Response("", { status: 402 });
      const ok = opts.jina === "ok" || opts.jina(target);
      return ok ? new Response(ARTICLE, { status: 200 }) : new Response("", { status: 451 });
    }
    if (url === "https://api.tavily.com/extract") {
      const asked = (JSON.parse(init?.body ?? "{}").urls as string[]);
      const results = asked.filter((u) => opts.tavily?.[u]).map((u) => ({ url: u, raw_content: opts.tavily![u] }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    return new Response("unexpected", { status: 599 });   // anything else is a direct fetch: must not happen
  });
}

beforeEach(() => { vi.stubEnv("TAVILY_API_KEY", "test-key"); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("articles", () => {
  it("Jina reads them; Tavily is not called when Jina can", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: "ok" });
    vi.stubGlobal("fetch", f);
    const out = await m.fetchArticleTexts(["https://news.example/a", "https://news.example/b"], m.createSearchProviderState());
    expect(out.map((o) => o.provider)).toEqual(["jina", "jina"]);
    expect(hosts(f)).toEqual(["r.jina.ai", "r.jina.ai"]);
  });
  it("what Jina cannot read goes to Tavily Extract, in one call", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: (u) => u.endsWith("/a"), tavily: { "https://news.example/b": ARTICLE } });
    vi.stubGlobal("fetch", f);
    const out = await m.fetchArticleTexts(["https://news.example/a", "https://news.example/b", "https://news.example/c"], m.createSearchProviderState());
    expect(out.map((o) => o.provider)).toEqual(["jina", "tavily_extract", null]);
    const tavilyCalls = f.mock.calls.filter((c) => String(c[0]).includes("tavily"));
    expect(tavilyCalls).toHaveLength(1);
    expect(JSON.parse(tavilyCalls[0][1]!.body!).urls).toEqual(["https://news.example/b", "https://news.example/c"]);
  });
});

describe("the company's own site", () => {
  it("Jina reads it; no Tavily, and never a direct fetch of the site", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: (u) => u === "https://acme.ai" || u.endsWith("/about") });
    vi.stubGlobal("fetch", f);
    const pages = await m.fetchCompanyWebsitePages("https://acme.ai", m.createSearchProviderState());
    expect(pages.map((p) => p.provider)).toEqual(["jina"]);   // /about is the same page: sent once
    expect(new Set(hosts(f))).toEqual(new Set(["r.jina.ai"]));
  });
  it("while Jina is down, Tavily Extract reads the pages in one call", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: "402", tavily: { "https://acme.ai": ARTICLE } });
    vi.stubGlobal("fetch", f);
    const pages = await m.fetchCompanyWebsitePages("https://acme.ai", m.createSearchProviderState());
    expect(pages.map((p) => [p.url, p.provider])).toEqual([["https://acme.ai", "tavily_extract"]]);
    expect(hosts(f).filter((h) => h === "api.tavily.com")).toHaveLength(1);
    expect(hosts(f).every((h) => h === "r.jina.ai" || h === "api.tavily.com")).toBe(true);
  });
});

describe("searches", () => {
  it("Tavily joins Serper only to go deeper, or while Jina is down", async () => {
    const m = await fresh();
    expect(m.tavilyJoins()).toBe(false);
    expect(m.tavilyJoins({ deep: true })).toBe(true);
    vi.stubGlobal("fetch", fakeFetch({ jina: "402" }));
    await m.fetchArticleTexts(["https://news.example/a"], m.createSearchProviderState());
    expect(m.tavilyJoins()).toBe(true);
  });
  it("a Jina outage is retried after a while (the worker runs for weeks)", async () => {
    const m = await fresh();
    vi.stubGlobal("fetch", fakeFetch({ jina: "402" }));
    await m.fetchArticleTexts(["https://news.example/a"], m.createSearchProviderState());
    expect(m.jinaDisabled()).toMatch(/402/);
    expect(m.jinaDisabled(Date.now() + m.JINA_RETRY_AFTER_MS + 1000)).toBeNull();
  });
});
