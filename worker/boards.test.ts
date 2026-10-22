import { describe, it, expect, vi } from "vitest";
import { atsLinksIn, careersLinkIn, linksIn, sameSite, isGenericSlug, namesMatch, decideLink, boardsBatch, boardsOnSite, boardFacts, linkedDomainsIn, leverWebsite, ashbyWebsite, LINK_RULES_VERSION, type LinkEvidenceInput } from "./boards";

describe("atsLinksIn", () => {
  it("reads every ATS's board links, in every URL form", () => {
    const page = `
      [Open roles](https://boards.greenhouse.io/psiquantum) · [Apply](https://job-boards.eu.greenhouse.io/riskledger/jobs/123)
      <iframe src="https://boards.greenhouse.io/embed/job_board?for=commure"></iframe>
      [Jobs](https://jobs.lever.co/modulate/abc-123) [Jobs](https://jobs.ashbyhq.com/incident) [Jobs](https://apply.workable.com/keboola/)
      [Careers](https://acme.workable.com) [Again](https://boards.greenhouse.io/psiquantum/jobs/9)`;
    expect(atsLinksIn(page).map((r) => `${r.provider}/${r.token}`).sort()).toEqual([
      "greenhouse/psiquantum", "greenhouse/riskledger", "greenhouse/commure",
      "lever/modulate", "ashby/incident", "workable/keboola", "workable/acme",
    ].sort());
  });
  it("is not fooled by the ATS's own pages", () => {
    expect(atsLinksIn("https://www.workable.com/pricing https://apply.workable.com/ https://boards-api.greenhouse.io/v1/boards/")).toEqual([]);
  });
});

describe("careersLinkIn", () => {
  it("finds the careers page on the same site, not elsewhere", () => {
    const md = "[Blog](https://acme.ai/blog) [Careers](https://careers.acme.ai/) [Jobs at Google](https://google.com/jobs)";
    expect(careersLinkIn(md, "https://acme.ai")).toBe("https://careers.acme.ai/");
    expect(careersLinkIn("[We're hiring](https://acme.ai/join-us)", "acme.ai")).toBe("https://acme.ai/join-us");
    expect(careersLinkIn("[Jobs](https://other.com/jobs)", "acme.ai")).toBeNull();
  });
  it("one site under its subdomains", () => {
    expect(sameSite("careers.acme.ai", "acme.ai")).toBe(true);
    expect(sameSite("acme.ai", "notacme.ai")).toBe(false);
  });
});

describe("isGenericSlug — the owner's examples", () => {
  it("common words and short slugs are generic", () => {
    for (const s of ["invisible", "fetch", "ema", "incident", "port", "bob"]) expect(isGenericSlug(s)).toBe(true);
  });
  it("distinctive slugs are not", () => {
    for (const s of ["psiquantum", "m7health", "wundergraph", "riskledger", "keboola"]) expect(isGenericSlug(s)).toBe(false);
  });
});

describe("namesMatch", () => {
  it("legal and generic suffixes aside", () => {
    expect(namesMatch("Risk Ledger Ltd", "Risk Ledger")).toBe(true);
    expect(namesMatch("Invisible Technologies", "Invisible AI")).toBe(true);   // why a generic slug never relies on the name
    expect(namesMatch("WunderGraph", "Wunder Graph")).toBe(true);
    expect(namesMatch("Modulate", "Modular")).toBe(false);
  });
});

const base = (o: Partial<LinkEvidenceInput> = {}): LinkEvidenceInput => ({
  company: { name: "PsiQuantum", website: "https://psiquantum.com" },
  board: { provider: "greenhouse", token: "psiquantum" },
  siteBoards: [], boardMeta: null, postingTexts: [], ...o,
});

describe("decideLink", () => {
  it("1. the company's site links to the board: verified", () => {
    expect(decideLink(base({ siteBoards: [{ provider: "greenhouse", token: "psiquantum", url: "u" }] }))).toMatchObject({ status: "verified", method: "website_link" });
  });
  it("2. the board's website: same domain verifies, another refutes", () => {
    expect(decideLink(base({ boardMeta: { website: "https://www.psiquantum.com/about" } }))).toMatchObject({ status: "verified", method: "domain_match" });
    expect(decideLink(base({ boardMeta: { website: "https://psi-quantum.net" } }))).toMatchObject({ status: "mismatch", method: "domain_match" });
  });
  it("3. the site links to a different board: mismatch", () => {
    const d = decideLink(base({ siteBoards: [{ provider: "lever", token: "psiquantum-inc", url: "u" }] }));
    expect(d).toMatchObject({ status: "mismatch", method: "website_link" });
    expect(d.evidence.site_links_to).toEqual(["lever/psiquantum-inc"]);
  });
  it("4. a generic slug is not verified by name or content — unverifiable", () => {
    const invisible = base({ company: { name: "Invisible AI", website: "https://invisible.ai" }, board: { provider: "greenhouse", token: "invisible" },
      boardMeta: { name: "Invisible" }, postingTexts: ["Invisible is hiring", "Join Invisible"] });
    expect(decideLink(invisible)).toMatchObject({ status: "unverifiable", method: null });
    // ...but its own site or domain still verifies it.
    expect(decideLink({ ...invisible, siteBoards: [{ provider: "greenhouse", token: "invisible", url: "u" }] })).toMatchObject({ status: "verified", method: "website_link" });
    expect(decideLink({ ...invisible, boardMeta: { name: "Invisible", website: "invisible.ai" } })).toMatchObject({ status: "verified", method: "domain_match" });
  });
  it("5. the postings give the company's domain: verified", () => {
    expect(decideLink(base({ postingTexts: ["Apply at careers@psiquantum.com", "Visit https://psiquantum.com/about"] }))).toMatchObject({ status: "verified", method: "posting_domain" });
    // the domain as a whole word only
    expect(decideLink(base({ postingTexts: ["notpsiquantum.com is hiring", "see notpsiquantum.com"] })).status).not.toBe("verified");
  });
  it("5b. a generic slug is not verified by the domain in postings either (needs site link or board domain)", () => {
    const d = decideLink(base({ company: { name: "Invisible AI", website: "https://invisible.ai" }, board: { provider: "greenhouse", token: "invisible" }, postingTexts: ["invisible.ai", "invisible.ai"] }));
    expect(d.status).toBe("unverifiable");
  });
  it("6. the name alone is never verified — low confidence (decision of 2026-10-22)", () => {
    // Guardsquare: the board's own name agrees — still only low confidence
    expect(decideLink(base({ boardMeta: { name: "PsiQuantum Corp" } }))).toMatchObject({ status: "low_confidence", method: "name_match" });
    // a name that differs a little ("Risk Ledger Ltd" / riskledger) — still low confidence
    expect(decideLink(base({ company: { name: "Risk Ledger", website: "https://riskledger.com" }, board: { provider: "greenhouse", token: "riskledger" }, boardMeta: { name: "Risk Ledger Ltd" } })))
      .toMatchObject({ status: "low_confidence", method: "name_match" });
    // another name refutes
    expect(decideLink(base({ boardMeta: { name: "Quantum Circuits" } }))).toMatchObject({ status: "mismatch", method: "name_match" });
  });
  it("7. Vasco: postings that only name the company are low confidence, not verified", () => {
    const vasco = base({ company: { name: "Vasco", website: "https://vasco.com" }, board: { provider: "ashby", token: "vasco" },
      postingTexts: ["Vasco is a translator company", "At Vasco we build devices"] });
    expect(decideLink(vasco)).toMatchObject({ status: "low_confidence", method: "content_match" });
    // ...its domain in the postings makes it verified
    expect(decideLink({ ...vasco, postingTexts: ["Apply: jobs@vasco.com", "vasco.com/careers"] })).toMatchObject({ status: "verified", method: "posting_domain" });
    // ...another website on the board makes it someone else's
    expect(decideLink({ ...vasco, boardMeta: { website: "https://vasco-electronics.com" } })).toMatchObject({ status: "mismatch", method: "domain_match" });
    expect(decideLink(base({ postingTexts: ["We build photonic chips", "Join our team"] }))).toMatchObject({ status: "unverifiable" });
  });
  it("2b. sites the board's intro links to verify, never refute", () => {
    expect(decideLink(base({ boardMeta: { name: "X", linkedDomains: ["linkedin.com", "psiquantum.com"] } }))).toMatchObject({ status: "verified", method: "domain_match" });
    // an intro linking to an investor is not a mismatch: falls through to the name
    expect(decideLink(base({ boardMeta: { name: "PsiQuantum", linkedDomains: ["a16z.com"] } }))).toMatchObject({ status: "low_confidence" });
  });
  it("only strong methods verify", () => {
    const strong = new Set(["website_link", "domain_match", "posting_domain"]);
    const cases: Array<Partial<LinkEvidenceInput>> = [
      { boardMeta: { name: "PsiQuantum" } }, { postingTexts: ["PsiQuantum", "PsiQuantum"] }, { boardMeta: { website: "psiquantum.com" } },
      { siteBoards: [{ provider: "greenhouse", token: "psiquantum", url: "u" }] }, { postingTexts: ["psiquantum.com", "psiquantum.com"] },
    ];
    for (const c of cases) {
      const d = decideLink(base(c));
      if (d.status === "verified") expect(strong.has(d.method!)).toBe(true);
      expect(d.evidence.rules).toBe(LINK_RULES_VERSION);
    }
  });
  it("the site could not be read: nothing is inferred from that", () => {
    expect(decideLink(base({ siteBoards: null }))).toMatchObject({ status: "unverifiable" });
  });
});

describe("boardsBatch", () => {
  it("checks a claimed board, records the verdict, and registers a board the site links to", async () => {
    const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
    const db = { rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === "claim_board_links") return { data: [{ id: "b1", ats_provider: "greenhouse", ats_board_token: "invisible", startup_id: "s1", startup_name: "Invisible AI", website: "https://invisible.ai" }], error: null };
      if (name === "register_board_from_website") return { data: "registered", error: null };
      return { data: null, error: null };
    }) };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://r.jina.ai/https://invisible.ai") return new Response("# Invisible AI\n[Careers](https://invisible.ai/careers)");
      if (url === "https://r.jina.ai/https://invisible.ai/careers") return new Response("Open roles: [See all](https://jobs.lever.co/invisibleai)");
      if (url.startsWith("https://boards-api.greenhouse.io")) return new Response(JSON.stringify({ name: "Invisible", jobs: [] }));
      if (url.startsWith("https://api.lever.co/v0/postings/invisibleai")) return new Response("[]");
      return new Response("", { status: 404 });
    });
    const r = await boardsBatch({ db: db as never, fetch: fetchMock as never, log: () => {} }, 3);
    expect(r).toMatchObject({ checked: 1, mismatch: 1, registered: 1 });
    expect(rpcs.find((x) => x.name === "claim_board_links")?.args).toMatchObject({ p_rule_version: LINK_RULES_VERSION });
    expect(rpcs.find((x) => x.name === "record_board_link")?.args).toMatchObject({ p_id: "b1", p_status: "mismatch", p_method: "website_link", p_rule_version: LINK_RULES_VERSION });
    expect(rpcs.find((x) => x.name === "register_board_from_website")?.args).toMatchObject({ p_startup_id: "s1", p_provider: "lever", p_token: "invisibleai" });
  });
});

describe("atsLinksIn — embeds and escaped URLs", () => {
  it("the Greenhouse embed script, and URLs inside scripts/JSON", () => {
    const html = `<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmeco"></script>
      <script>var c = {"jobs":"https:\\/\\/jobs.ashbyhq.com\\/acme-ai"}</script>
      <iframe src="https://job-boards.greenhouse.io/embed/job_board?v=2&amp;for=wundergraph"></iframe>`;
    expect(atsLinksIn(html).map((r) => `${r.provider}/${r.token}`).sort()).toEqual(["ashby/acme-ai", "greenhouse/acmeco", "greenhouse/wundergraph"]);
  });
});

describe("linksIn / careersLinkIn on raw HTML", () => {
  it("reads <a href>, relative ones included", () => {
    const html = `<nav><a href="/about">About</a><a class="x" href="/careers/">Careers</a><a href="https://other.com/jobs">Jobs</a></nav>`;
    expect(linksIn(html, "https://acme.ai").map((l) => l.url)).toEqual(["https://acme.ai/about", "https://acme.ai/careers/", "https://other.com/jobs"]);
    expect(careersLinkIn(html, "https://acme.ai")).toBe("https://acme.ai/careers/");
    expect(careersLinkIn(`<a href="/join"><span>Join us</span></a>`, "acme.ai")).toBe("https://acme.ai/join");
  });
});

describe("the board's own website", () => {
  it("Lever: the header logo link", () => {
    expect(leverWebsite(`<div class="main-header"><a class="main-header-logo" href="https://www.vasco-electronics.com"><img alt="Vasco logo"></a></div>`)).toBe("https://www.vasco-electronics.com");
    expect(leverWebsite(`<a href="https://acme.com" class="main-header-logo">`)).toBe("https://acme.com");
    expect(leverWebsite(`<a class="main-header-logo" href="https://lever.co">`)).toBeNull();
    expect(leverWebsite(null)).toBeNull();
  });
  it("Ashby: publicWebsite in the app data", () => {
    expect(ashbyWebsite(`window.__appData = {"organization":{"name":"Vasco","publicWebsite":"https:\\/\\/vasco.com"}}`)).toBe("https://vasco.com");
    expect(ashbyWebsite(`{"publicWebsite":"https://www.linkedin.com/company/x"}`)).toBeNull();
    expect(ashbyWebsite("<html></html>")).toBeNull();
  });
  it("Greenhouse: the sites its intro links to, social networks and the ATS aside", () => {
    expect(linkedDomainsIn(`&lt;p&gt;Learn more at &lt;a href="https://www.guardsquare.com/about"&gt;us&lt;/a&gt; https://linkedin.com/company/g https://boards.greenhouse.io/x&lt;/p&gt;`)).toEqual(["guardsquare.com"]);
  });
  it("boardFacts reads Ashby's board page for the website", async () => {
    const f = vi.fn(async (url: string) => {
      if (url === "https://api.ashbyhq.com/posting-api/job-board/vasco") return new Response(JSON.stringify({ jobs: [{ descriptionPlain: "Vasco is hiring" }] }));
      if (url === "https://jobs.ashbyhq.com/vasco") return new Response(`{"publicWebsite":"https://vasco-electronics.com"}`, { headers: { "content-type": "text/html" } });
      return new Response("", { status: 404 });
    });
    const facts = await boardFacts(f as never, { provider: "ashby", token: "vasco" });
    expect(facts).toMatchObject({ exists: true, meta: { website: "https://vasco-electronics.com" }, postings: ["Vasco is hiring"] });
  });
});

describe("boardsOnSite", () => {
  const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  it("finds the embed in the page's own HTML, without Jina", async () => {
    const f = vi.fn(async (url: string) => {
      if (url === "https://acme.ai") return html(`<a href="/careers">Careers</a>`);
      if (url === "https://acme.ai/careers") return html(`<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>`);
      return new Response("", { status: 404 });
    });
    expect(await boardsOnSite(f as never, "acme.ai")).toEqual({ boards: [{ provider: "greenhouse", token: "acme", url: expect.any(String) }], page: "https://acme.ai/careers" });
    expect(f.mock.calls.some(([u]) => String(u).includes("r.jina.ai"))).toBe(false);
  });
  it("tries /careers and /jobs when the home page links to neither, and asks Jina only for pages that answer", async () => {
    const f = vi.fn(async (url: string) => {
      if (url === "https://acme.ai") return html(`<a href="/about">About</a>`);
      if (url === "https://acme.ai/careers") return new Response("", { status: 404 });
      if (url === "https://acme.ai/jobs") return html(`<div id="root"></div>`);   // built by JavaScript
      if (url === "https://r.jina.ai/https://acme.ai/jobs") return new Response("[Apply](https://jobs.lever.co/acme/123)");
      return new Response("", { status: 404 });
    });
    expect((await boardsOnSite(f as never, "https://acme.ai"))?.boards.map((b) => `${b.provider}/${b.token}`)).toEqual(["lever/acme"]);
    expect(f.mock.calls.map(([u]) => String(u))).not.toContain("https://r.jina.ai/https://acme.ai/careers");
  });
  it("the site cannot be read at all: null (nothing inferred)", async () => {
    const f = vi.fn(async () => new Response("", { status: 503 }));
    expect(await boardsOnSite(f as never, "acme.ai")).toBeNull();
  });
});
