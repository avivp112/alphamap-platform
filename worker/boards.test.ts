import { describe, it, expect, vi } from "vitest";
import { atsLinksIn, careersLinkIn, linksIn, sameSite, isGenericSlug, namesMatch, namesCompatible, decideLink, boardsBatch, boardsOnSite, boardFacts, finalDomain, comeetLinksIn, linkedDomainsIn, leverWebsite, ashbyWebsite, LINK_RULES_VERSION, type LinkEvidenceInput } from "./boards";

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
    expect(decideLink(base({ boardMeta: { name: "PsiQuantum Inc", linkedDomains: ["linkedin.com", "psiquantum.com"] } }))).toMatchObject({ status: "verified", method: "domain_match" });
    // rules 4: a board calling itself something else is not verified by its intro's links
    expect(decideLink(base({ boardMeta: { name: "Quantum Circuits", linkedDomains: ["psiquantum.com"] } }))).toMatchObject({ status: "unverifiable" });
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

describe("one company, two domains (rules 3)", () => {
  const redis = (redirects?: Record<string, string | null>) => decideLink(base({
    company: { name: "Redis", website: "https://redis.com" }, board: { provider: "ashby", token: "redis" },
    boardMeta: { website: "https://redis.io/" }, redirects,
  }));
  it("one domain redirecting to the other verifies", () => {
    expect(redis({ "redis.io": "redis.io", "redis.com": "redis.io" })).toMatchObject({ status: "verified", method: "domain_match", evidence: { redirect: "redis.com -> redis.io" } });
    expect(redis({ "redis.io": "www.redis.com", "redis.com": "redis.com" })).toMatchObject({ status: "verified", evidence: { redirect: "redis.io -> www.redis.com" } });
  });
  it("no redirect, or both landing on a third site (parked domains): still a mismatch", () => {
    expect(redis(undefined)).toMatchObject({ status: "mismatch" });
    expect(redis({ "redis.io": null, "redis.com": null })).toMatchObject({ status: "mismatch" });
    expect(redis({ "redis.io": "sedo.com", "redis.com": "sedo.com" })).toMatchObject({ status: "mismatch" });
  });
  it("Savvy: two different companies stay a mismatch", () => {
    expect(decideLink(base({ company: { name: "Savvy", website: "https://savvy.security" }, board: { provider: "ashby", token: "savvy" },
      boardMeta: { website: "https://savvywealth.com" }, redirects: { "savvywealth.com": "savvywealth.com", "savvy.security": "savvy.security" } })))
      .toMatchObject({ status: "mismatch" });
  });
  it("finalDomain follows the response's final URL", async () => {
    const res = new Response("ok");
    Object.defineProperty(res, "url", { value: "https://www.redis.io/" });
    expect(await finalDomain((async () => res) as never, "redis.com")).toBe("redis.io");
    expect(await finalDomain((async () => new Response("", { status: 404 })) as never, "x.com")).toBeNull();
  });
});

describe("Comeet", () => {
  it("finds the hosted careers page in a link, keeping the uid's case", () => {
    const page = `<a href="https://www.comeet.com/jobs/Sett/4A.00B/deployment-strategist/37.071">Apply</a>
      <a href="https://www.comeet.com/jobs/sett/4a.00b">All jobs</a>`;
    expect(comeetLinksIn(page)).toEqual([{ provider: "comeet", token: "sett/4A.00B", url: "https://www.comeet.com/jobs/Sett/4A.00B" }]);
    expect(atsLinksIn(page).map((r) => `${r.provider}/${r.token}`)).toEqual(["comeet/sett/4A.00B"]);
  });
  it("finds the careers widget's uid, with its company name for the slug", () => {
    const widget = `<script>window.comeetInit = function() { COMEET.init({ "token": "abc", "company-uid": "41.00B", "company-name": "Monday.com" }); };</script>`;
    expect(comeetLinksIn(widget).map((r) => r.token)).toEqual(["monday-com/41.00B"]);
    // a uid with no name: no URL can be built, nothing is registered
    expect(comeetLinksIn(`"company-uid": "41.00B"`)).toEqual([]);
    expect(comeetLinksIn("comeet is great")).toEqual([]);
  });
  const sett = base({ company: { name: "Sett", website: "https://sett.ai" }, board: { provider: "comeet", token: "sett/4A.00B" } });
  it("the board's own website (COMPANY_DATA.website) verifies or refutes it", () => {
    expect(decideLink({ ...sett, boardMeta: { name: "Sett", website: "https://www.sett.ai/" } })).toMatchObject({ status: "verified", method: "domain_match" });
    expect(decideLink({ ...sett, boardMeta: { name: "Sett", website: "https://sett.com" } })).toMatchObject({ status: "mismatch" });
    // positions published on the company's own site verify too
    expect(decideLink({ ...sett, boardMeta: { name: "Sett", linkedDomains: ["sett.ai"] } })).toMatchObject({ status: "verified", method: "domain_match" });
  });
  it("the site links to the same board under another slug: still the same board (by uid)", () => {
    expect(decideLink({ ...sett, siteBoards: [{ provider: "comeet", token: "sett-ai/4A.00B", url: "u" }] })).toMatchObject({ status: "verified", method: "website_link" });
  });
  it("a short slug is judged by the slug part, not the uid", () => {
    expect(decideLink({ ...sett, boardMeta: { name: "Sett" } }).status).toBe("unverifiable");
  });
  it("boardFacts reads the hosted page: website, the company-site domains of positions, posting texts", async () => {
    const html = `<script>COMPANY_DATA = {"name": "Sett", "website": "https://www.sett.ai/", "company_uid": "4A.00B"};
      COMPANY_POSITIONS_DATA = [{"uid": "1", "name": "AE", "url_active_page": "https://www.sett.ai/careers/ae/1/",
        "details": [{"name": "Description", "value": "<p>Join Sett</p>"}]}];</script>`;
    const f = vi.fn(async (url: string) => url === "https://www.comeet.com/jobs/sett/4A.00B"
      ? new Response(html, { headers: { "content-type": "text/html" } }) : new Response("", { status: 404 }));
    expect(await boardFacts(f as never, { provider: "comeet", token: "sett/4A.00B" })).toEqual({
      exists: true, meta: { name: "Sett", website: "https://www.sett.ai/", linkedDomains: ["sett.ai"] }, postings: ["Join Sett"],
    });
    const blocked = vi.fn(async () => new Response("<html>denied</html>", { headers: { "content-type": "text/html" } }));
    expect(await boardFacts(blocked as never, { provider: "comeet", token: "sett/4A.00B" })).toMatchObject({ exists: false });
  });
});

describe("Comeet's careers API is not used (owner, 2026-10-24)", () => {
  it("is never called, even when a site's pages carry the widget's token", async () => {
    const html = (b: string) => new Response(b, { headers: { "content-type": "text/html" } });
    const widget = `<script>COMEET.init({"token":"A4B480D292C149652585CA333775CA35CA33377","company-uid":"4A.00B"});</script>`;
    const f = vi.fn(async (url: string) => {
      if (url === "https://www.sett.ai") return html(`<a href="/careers/">Careers</a>`);
      if (url === "https://www.sett.ai/careers/") return html(`<a href="/careers/account-manager/75.474/">AM</a>`);
      if (url === "https://www.sett.ai/careers/account-manager/75.474/") return html(widget);
      return new Response("", { status: 404 });
    });
    expect(await boardsOnSite(f as never, "https://www.sett.ai")).toEqual({ boards: [], page: "https://www.sett.ai" });
    expect(f.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("careers-api"))).toEqual([]);
  });
});

describe("SmartRecruiters, Teamtailor, Personio, Recruitee on company sites", () => {
  it("their board links, the ATSs' own subdomains aside; a SmartRecruiters id keeps its case", () => {
    const page = `<a href="https://jobs.smartrecruiters.com/BoschGroup/744000157427223">x</a>
      <a href="https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/1">apply</a>
      <a href="https://acme.teamtailor.com/jobs">x</a><a href="https://career.teamtailor.com/jobs">theirs</a><a href="https://app.teamtailor.com">app</a>
      <a href="https://acme-gmbh.jobs.personio.de/">x</a><a href="https://acme2.jobs.personio.com/job/1">x</a>
      <a href="https://watchvice.recruitee.com/o/x">x</a><a href="https://www.recruitee.com">vendor</a>`;
    expect(atsLinksIn(page).map((r) => `${r.provider}/${r.token}`).sort()).toEqual([
      "personio/acme-gmbh", "personio/acme2", "recruitee/watchvice", "smartrecruiters/BoschGroup", "teamtailor/acme",
    ]);
  });
  it("Teamtailor: the website its postings declare verifies or refutes; its own careers domain verifies", async () => {
    const feed = { title: "Acme", home_page_url: "https://careers.acme.com/jobs", items: [{ content_html: "<p>Join Acme</p>",
      _jobposting: { hiringOrganization: { sameAs: "https://acme.com" } } }] };
    const f = vi.fn(async (url: string) => url === "https://acme.teamtailor.com/jobs.json" ? new Response(JSON.stringify(feed)) : new Response("", { status: 404 }));
    const facts = await boardFacts(f as never, { provider: "teamtailor", token: "acme" });
    expect(facts).toEqual({ exists: true, meta: { name: "Acme", website: "https://acme.com", linkedDomains: ["careers.acme.com"] }, postings: ["Join Acme"] });
    const acme = base({ company: { name: "Acme Robotics", website: "https://acme.com" }, board: { provider: "teamtailor", token: "acme" } });
    expect(decideLink({ ...acme, boardMeta: facts.meta })).toMatchObject({ status: "verified", method: "domain_match" });
    expect(decideLink({ ...acme, boardMeta: { website: "https://acme.io" } })).toMatchObject({ status: "mismatch" });
  });
  it("SmartRecruiters: a company with no posting is not a board to register", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ totalFound: 0, content: [] })));
    expect(await boardFacts(f as never, { provider: "smartrecruiters", token: "Nobody" })).toMatchObject({ exists: false });
  });
  it("Recruitee: offers on the company's own careers domain verify it", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ offers: [{ company_name: "Acme", careers_url: "https://jobs.acme.com/o/x", description: "<p>hi</p>" }] })));
    expect(await boardFacts(f as never, { provider: "recruitee", token: "acme" })).toEqual({ exists: true, meta: { name: "Acme", linkedDomains: ["jobs.acme.com"] }, postings: ["hi"] });
  });
});

describe("rules 4: the board's own declarations first, no proof from a list of boards", () => {
  it("our site links to a board that names another company (a wrong website on file): not verified", () => {
    // Heroine's site linked to Grailed's board (seen 2026-10-24)
    const d = decideLink(base({ company: { name: "Heroine", website: "https://heroine.com" }, board: { provider: "greenhouse", token: "grailed" },
      siteBoards: [{ provider: "greenhouse", token: "grailed", url: "u" }], boardMeta: { name: "Grailed" } }));
    expect(d).toMatchObject({ status: "unverifiable", evidence: { reason: expect.stringContaining("conflicting") } });
  });
  it("our site links to a board that declares another website: mismatch, the link notwithstanding", () => {
    expect(decideLink(base({ siteBoards: [{ provider: "greenhouse", token: "psiquantum", url: "u" }], boardMeta: { website: "https://parent-co.com" } })))
      .toMatchObject({ status: "mismatch", method: "domain_match" });
  });
  it("legal suffixes are not a different name", () => {
    expect(decideLink(base({ siteBoards: [{ provider: "greenhouse", token: "psiquantum", url: "u" }], boardMeta: { name: "PsiQuantum Corporation" } })))
      .toMatchObject({ status: "verified", method: "website_link" });
    expect(namesMatch("Dremio Corporation", "Dremio")).toBe(true);
    expect(namesMatch("Acme GmbH & Co. KG", "Acme")).toBe(true);
  });
  it("the postings give our domain but the board names another company: not verified", () => {
    expect(decideLink(base({ boardMeta: { name: "Quantum Circuits" }, postingTexts: ["psiquantum.com", "psiquantum.com"] })).status).toBe("unverifiable");
  });
  it("a page linking to many boards (a portfolio page) proves nothing — no link, and no 'links elsewhere' either", () => {
    const many = ["a", "b", "c", "psiquantum"].map((t) => ({ provider: "greenhouse" as const, token: t, url: "u" }));
    const d = decideLink(base({ siteBoards: many }));
    expect(d.status).not.toBe("verified");
    expect(d.method).not.toBe("website_link");
    expect(decideLink(base({ siteBoards: many.slice(0, 3) })).status).toBe("mismatch");   // 3 boards: still the company's page, links elsewhere
  });
  it("a site scan does not register a board that would not be verified", async () => {
    const rpcs: string[] = [];
    const db = { rpc: vi.fn(async (name: string) => {
      rpcs.push(name);
      if (name === "claim_board_links") return { data: [], error: null };
      if (name === "claim_board_site_scans") return { data: [{ startup_id: "s1", startup_name: "Heroine", website: "https://heroine.com" }], error: null };
      return { data: "registered", error: null };
    }) };
    const f = vi.fn(async (url: string) => {
      if (url === "https://heroine.com") return new Response(`<a href="https://boards.greenhouse.io/grailed">Careers</a>`, { headers: { "content-type": "text/html" } });
      if (url === "https://boards-api.greenhouse.io/v1/boards/grailed") return new Response(JSON.stringify({ name: "Grailed" }));
      if (url === "https://boards-api.greenhouse.io/v1/boards/grailed/jobs?content=true") return new Response(JSON.stringify({ jobs: [] }));
      return new Response("", { status: 404 });
    });
    const r = await boardsBatch({ db: db as never, fetch: f as never, log: () => {} }, 3);
    expect(r).toMatchObject({ scanned: 1, registered: 0 });
    expect(rpcs).not.toContain("register_board_from_website");
  });
});

describe("rules 5: one company's names (the 62 boards rules 4 hid, 2026-10-24)", () => {
  const same: Array<[string, string]> = [
    ["AppGate Cybersecurity, Inc.", "Appgate"], ["Calm.com", "Calm"], ["Cloud9 Esports", "Cloud9"], ["Cognite - AI for Industry", "Cognite"],
    ["Faherty Brand", "Faherty"], ["Funding Societies | Modalku Group", "Funding Societies"], ["Headspace", "Headspace Health"],
["Isomorphic Labs", "Isomorphic Laboratories"], ["Kodiak", "Kodiak Robotics"],
    ["Komodo Health", "Komodo"], ["Later", "Later Influence"], ["LTK USA", "LTK"],
    ["Luma Health", "Luma"], ["Mantra Health", "Mantra"], ["May Mobility (Part-Time)", "May Mobility"], ["Mercer Advisors", "Mercer"],
    ["Palmetto Clean Technology", "Palmetto"], ["Parachute Home", "Parachute"],
    ["Piermont Bank", "Piermont"], ["Plum Fintech", "Plum"], ["The Predictive Index", "Predictive Index"], ["Quilt", "Quilt Comfort"],
    ["Grupo QuintoAndar", "QuintoAndar"], ["Redwood Materials", "Redwood"], ["Splash Financial", "Splash"], ["Synack SRT", "Synack"],
    ["Trust Bank", "Trust"], ["Valera Health", "Valera"], ["VideoAmp Careers Website", "VideoAmp"], ["Jobs @ Wunderflats", "Wunderflats"],
    ["YugabyteDB", "YugaByte"], ["Zesty.ai", "ZestyAI"], ["AIRCO", "Air Company"],
  ];
  it.each(same)("%s is %s's board", (board, ours) => expect(namesCompatible(board, ours)).toBe(true));
  const other: Array<[string, string]> = [
    ["Grailed", "Heroine"], ["Relae", "Carbon Direct"], ["Arc Institute", "Evo"], ["Natera", "ChartHop"], ["Attivo Partners", "Numeric"],
    ["Zinier", "Remote"], ["Sail Biomedicines", "Senda Biosciences"], ["Bolt.new", "StackBlitz"], ["Happy Money", "Payoff"],
    ["Quantum Circuits", "PsiQuantum"],
    // the accepted limit: the same first word with different rest stays apart (missing, never wrong)
    ["Headspace Providers", "Headspace Health"], ["Montai Therapeutics", "Montai Health"], ["Leapfrog Power, Inc.", "Leap Energy"],
  ];
  it.each(other)("%s is not %s's board", (board, ours) => expect(namesCompatible(board, ours)).toBe(false));
  it("a real board with a longer name is verified by the company's link again", () => {
    expect(decideLink(base({ company: { name: "Komodo", website: "https://komodohealth.com" }, board: { provider: "greenhouse", token: "komodohealth" },
      siteBoards: [{ provider: "greenhouse", token: "komodohealth", url: "u" }], boardMeta: { name: "Komodo Health" } }))).toMatchObject({ status: "verified", method: "website_link" });
  });
});
