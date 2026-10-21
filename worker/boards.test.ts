import { describe, it, expect, vi } from "vitest";
import { atsLinksIn, careersLinkIn, sameSite, isGenericSlug, namesMatch, decideLink, boardsBatch, type LinkEvidenceInput } from "./boards";

describe("atsLinksIn", () => {
  it("reads every ATS's board links, in every URL form", () => {
    const page = `
      [Open roles](https://boards.greenhouse.io/psiquantum) · [Apply](https://job-boards.eu.greenhouse.io/riskledger/jobs/123)
      <iframe src="https://boards.greenhouse.io/embed/job_board?for=commure"></iframe>
      [Jobs](https://jobs.lever.co/modulate/abc-123) [Jobs](https://jobs.ashbyhq.com/incident) [Jobs](https://apply.workable.com/keboola/)
      [Careers](https://acme.workable.com) [Again](https://boards.greenhouse.io/psiquantum/jobs/9)`;
    expect(atsLinksIn(page).map((r) => `${r.provider}/${r.token}`)).toEqual([
      "greenhouse/psiquantum", "greenhouse/riskledger", "greenhouse/commure",
      "lever/modulate", "ashby/incident", "workable/keboola", "workable/acme",
    ]);
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
  it("5. the board's company name", () => {
    expect(decideLink(base({ boardMeta: { name: "PsiQuantum Corp" } }))).toMatchObject({ status: "verified", method: "name_match" });
    expect(decideLink(base({ boardMeta: { name: "Quantum Circuits" } }))).toMatchObject({ status: "mismatch", method: "name_match" });
  });
  it("6. postings that name the company", () => {
    expect(decideLink(base({ postingTexts: ["At PsiQuantum we build...", "PsiQuantum is hiring", "Visit psiquantum.com"] }))).toMatchObject({ status: "verified", method: "content_match" });
    expect(decideLink(base({ postingTexts: ["We build photonic chips", "Join our team"] }))).toMatchObject({ status: "unverifiable" });
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
    expect(rpcs.find((x) => x.name === "record_board_link")?.args).toMatchObject({ p_id: "b1", p_status: "mismatch", p_method: "website_link" });
    expect(rpcs.find((x) => x.name === "register_board_from_website")?.args).toMatchObject({ p_startup_id: "s1", p_provider: "lever", p_token: "invisibleai" });
  });
});
