import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Provider order, owner's decisions of 2026-10-20 and 2026-10-29: Serper
// searches and Jina reads, and each backs the other up — Jina Search answers
// what Serper could not, and joins it going deeper; Serper scrape reads what
// Jina could not. Tavily only when both failed; no direct (cheerio) fetch of
// anyone's site. Each test loads the module fresh, since "Jina is down" is
// module state.
const ARTICLE = "Acme Robotics today announced a $20 million Series A led by Example Ventures. ".repeat(12);
type Mod = typeof import("./searchProviders");
async function fresh(): Promise<Mod> { vi.resetModules(); return import("./searchProviders"); }

const hosts = (m: ReturnType<typeof vi.fn>) => m.mock.calls.map((c) => new URL(String(c[0])).hostname);
const organic = (urls: string[]) => JSON.stringify({ organic: urls.map((link) => ({ title: "Acme", link, snippet: "Acme raises" })) });
const jinaResults = (urls: string[]) => JSON.stringify({ code: 200, data: urls.map((url) => ({ title: "Acme", url, description: "Acme raises" })) });

function fakeFetch(opts: {
  jina?: "ok" | "402" | ((url: string) => boolean);
  serper?: "ok" | "down";
  serperResults?: string[];
  jinaSearch?: string[] | "402";
  scrape?: Record<string, string>;
  tavily?: Record<string, string>;
}) {
  return vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.startsWith("https://r.jina.ai/")) {
      const target = url.slice("https://r.jina.ai/".length);
      if (opts.jina === "402") return new Response("", { status: 402 });
      const ok = opts.jina === "ok" || (typeof opts.jina === "function" && opts.jina(target));
      return ok ? new Response(ARTICLE, { status: 200 }) : new Response("", { status: 451 });
    }
    if (url.startsWith("https://s.jina.ai/")) {
      if (opts.jinaSearch === "402") return new Response("", { status: 402 });
      return new Response(jinaResults(opts.jinaSearch ?? []), { status: 200 });
    }
    if (url.startsWith("https://google.serper.dev/")) {
      if (opts.serper === "down") throw new TypeError("fetch failed");
      return new Response(organic(opts.serperResults ?? []), { status: 200 });
    }
    if (url === "https://scrape.serper.dev") {
      const asked = JSON.parse(init?.body ?? "{}").url as string;
      const text = opts.scrape?.[asked];
      return text ? new Response(JSON.stringify({ text }), { status: 200 }) : new Response("", { status: 500 });
    }
    if (url === "https://api.tavily.com/extract") {
      const asked = (JSON.parse(init?.body ?? "{}").urls as string[]);
      const results = asked.filter((u) => opts.tavily?.[u]).map((u) => ({ url: u, raw_content: opts.tavily![u] }));
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    if (url === "https://api.tavily.com/search") return new Response(JSON.stringify({ results: [] }), { status: 200 });
    return new Response("unexpected", { status: 599 });   // anything else is a direct fetch: must not happen
  });
}

beforeEach(() => {
  vi.stubEnv("SERP_KEY", "test-key"); vi.stubEnv("JINA_API_KEY", "test-key"); vi.stubEnv("TAVILY_API_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** Serper's network retries wait between tries — run those pauses at once. */
async function settled<T>(p: Promise<T>): Promise<T> { await vi.runAllTimersAsync(); return p; }

describe("articles", () => {
  it("Jina reads them; Serper scrape is not called when Jina can", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: "ok" });
    vi.stubGlobal("fetch", f);
    const out = await m.fetchArticleTexts(["https://news.example/a", "https://news.example/b"], m.createSearchProviderState());
    expect(out.map((o) => o.provider)).toEqual(["jina", "jina"]);
    expect(hosts(f)).toEqual(["r.jina.ai", "r.jina.ai"]);
  });
  it("what Jina cannot read, Serper scrape reads", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: (u) => u.endsWith("/a"), scrape: { "https://news.example/b": ARTICLE } });
    vi.stubGlobal("fetch", f);
    const out = await m.fetchArticleTexts(["https://news.example/a", "https://news.example/b", "https://news.example/c"], m.createSearchProviderState());
    expect(out.map((o) => o.provider)).toEqual(["jina", "serper_scrape", null]);
  });
});

describe("the company's own site", () => {
  it("Jina reads it; never a direct fetch of the site", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: (u) => u === "https://acme.ai" || u.endsWith("/about") });
    vi.stubGlobal("fetch", f);
    const pages = await m.fetchCompanyWebsitePages("https://acme.ai", m.createSearchProviderState());
    expect(pages.map((p) => p.provider)).toEqual(["jina"]);   // /about is the same page: sent once
    expect(hosts(f).every((h) => h === "r.jina.ai" || h === "scrape.serper.dev")).toBe(true);
  });
  it("while Jina is out of credit (eval run of 2026-10-29), Serper scrape reads the pages", async () => {
    const m = await fresh();
    const f = fakeFetch({ jina: "402", scrape: { "https://acme.ai": ARTICLE } });
    vi.stubGlobal("fetch", f);
    const pages = await m.fetchCompanyWebsitePages("https://acme.ai", m.createSearchProviderState());
    expect(pages.map((p) => [p.url, p.provider])).toEqual([["https://acme.ai", "serper_scrape"]]);
    expect(hosts(f).every((h) => h === "r.jina.ai" || h === "scrape.serper.dev")).toBe(true);
  });
});

describe("searches", () => {
  it("Serper answers alone when it can — Jina Search is not called", async () => {
    const m = await fresh();
    const f = fakeFetch({ serperResults: ["https://news.example/a"] });
    vi.stubGlobal("fetch", f);
    const out = await m.webSearch('"Acme" funding', "funding", m.createSearchProviderState());
    expect(out.map((r) => r.provider)).toEqual(["serper"]);
    expect(hosts(f)).toEqual(["google.serper.dev"]);
  });
  it("Serper 'fetch failed' (eval run of 2026-10-29) — Jina Search answers instead", async () => {
    const m = await fresh();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fakeFetch({ serper: "down", jinaSearch: ["https://news.example/a"] }));
    const state = m.createSearchProviderState();
    const out = await settled(m.webSearch('"Acme" funding', "funding", state));
    expect(out.map((r) => [r.url, r.provider])).toEqual([["https://news.example/a", "jina_search"]]);
    const news = await settled(m.newsSearch('"Acme" news', '"Acme" news 2026', "news", state));
    expect(news.map((r) => r.provider)).toEqual(["jina_search"]);
  });
  it("going deeper, Jina Search joins Serper — merged, no URL twice", async () => {
    const m = await fresh();
    vi.stubGlobal("fetch", fakeFetch({ serperResults: ["https://news.example/a"], jinaSearch: ["https://news.example/a", "https://news.example/b"] }));
    const out = await m.webSearch('"Acme" funding', "deep_funding", m.createSearchProviderState(), { deep: true });
    expect(out.map((r) => [r.url, r.provider])).toEqual([["https://news.example/a", "serper"], ["https://news.example/b", "jina_search"]]);
  });
  it("a site: query keeps only that site's results from the backup", async () => {
    const m = await fresh();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fakeFetch({ serper: "down", jinaSearch: ["https://www.linkedin.com/company/acme", "https://spam.example/acme"] }));
    const out = await settled(m.webSearch('site:linkedin.com/company "Acme"', "linkedin", m.createSearchProviderState()));
    expect(out.map((r) => r.url)).toEqual(["https://www.linkedin.com/company/acme"]);
  });
  it("a Jina outage is retried after a while (the worker runs for weeks)", async () => {
    const m = await fresh();
    vi.stubGlobal("fetch", fakeFetch({ jina: "402" }));
    await m.fetchArticleTexts(["https://news.example/a"], m.createSearchProviderState());
    expect(m.jinaDisabled()).toMatch(/402/);
    expect(m.jinaDisabled(Date.now() + m.JINA_RETRY_AFTER_MS + 1000)).toBeNull();
  });
});
