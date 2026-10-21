// =============================================================================
// worker/boards.ts — is each job board really the company's? And which boards
// does a company's own website point to? (migration 20261027000000)
//
// discover-boards guesses a board's slug from the company's domain; this
// checks the guess, strongest evidence first (decideLink), and reads company
// websites for careers links to find the boards guessing missed.
//
// Runs in the check worker between users' checks, a few boards at a time:
// it reads public pages and public ATS APIs, gently.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDistinctiveName } from "../lib/enrichment/entity.ts";
import { websiteDomain } from "../lib/enrichment/websiteValidation.ts";

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workable";
export interface AtsRef { provider: AtsProvider; token: string; url: string }

// ── Reading ATS links out of a page ──────────────────────────────────────────

const ATS_PATTERNS: Array<{ provider: AtsProvider; re: RegExp }> = [
  { provider: "greenhouse", re: /https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/gi },
  { provider: "greenhouse", re: /https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi },
  { provider: "lever", re: /https?:\/\/jobs(?:\.eu)?\.lever\.co\/([a-z0-9_.-]+)/gi },
  { provider: "ashby", re: /https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/gi },
  { provider: "workable", re: /https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/gi },
  { provider: "workable", re: /https?:\/\/([a-z0-9-]+)\.workable\.com\b/gi },
];
const NOT_A_TOKEN = new Set(["embed", "v1", "api", "jobs", "www", "apply", "careers", "j", "o"]);

/** Every ATS board a page links to (deduplicated). */
export function atsLinksIn(text: string): AtsRef[] {
  const out: AtsRef[] = [];
  for (const { provider, re } of ATS_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const token = decodeURIComponent(m[1]).toLowerCase().replace(/[.,;)]+$/, "");
      if (!token || NOT_A_TOKEN.has(token)) continue;
      if (!out.some((r) => r.provider === provider && r.token === token)) out.push({ provider, token, url: m[0] });
    }
  }
  return out;
}

/** The careers page a home page links to, if any (same site only). */
export function careersLinkIn(markdown: string, site: string): string | null {
  const home = websiteDomain(site);
  for (const m of markdown.matchAll(/\[([^\]]{0,80})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const [, text, url] = m;
    const looksLikeCareers = /\b(careers?|jobs?|join (?:us|the team)|we'?re hiring|open (?:roles|positions)|work (?:with|at) us)\b/i.test(text)
      || /\/(careers?|jobs?|join-us|work-with-us|open-roles)(\/|$|\?)/i.test(url);
    if (!looksLikeCareers) continue;
    const d = websiteDomain(url);
    if (d && home && sameSite(d, home)) return url;
  }
  return null;
}

/** acme.com, www.acme.com and careers.acme.com are one site. */
export function sameSite(a: string, b: string): boolean {
  const x = a.replace(/^www\./, ""), y = b.replace(/^www\./, "");
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

// ── The decision ─────────────────────────────────────────────────────────────

/**
 * A slug that is a common word or very short (invisible, fetch, ema,
 * incident) may well be someone else's board: only the company's own site or
 * a matching domain can verify it.
 */
export function isGenericSlug(token: string): boolean {
  const t = token.replace(/[-_.]+/g, " ").trim();
  return t.replace(/\s/g, "").length <= 4 || !isDistinctiveName(t);
}

const LEGAL = /\b(inc|ltd|llc|gmbh|corp|co|ai|labs?|technologies|technology|tech|hq|group|holdings|limited|io|app|software)\b\.?/gi;
const nameKey = (s: string) => s.toLowerCase().replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** Same company name, once legal and generic suffixes are set aside ("Risk Ledger" / "Risk Ledger Ltd"). */
export function namesMatch(a: string, b: string): boolean {
  const x = nameKey(a), y = nameKey(b);
  return !!x && !!y && (x === y || x.replace(/\s/g, "") === y.replace(/\s/g, ""));
}

export type LinkStatus = "verified" | "mismatch" | "unverifiable";
export type LinkMethod = "website_link" | "domain_match" | "name_match" | "content_match";

export interface LinkEvidenceInput {
  company: { name: string; website: string | null };
  board: { provider: AtsProvider; token: string };
  /** ATS boards the company's own site links to; null when the site could not be read. */
  siteBoards: AtsRef[] | null;
  /** The page those links were found on. */
  sitePage?: string | null;
  /** What the ATS says about the board itself, where it says anything. */
  boardMeta: { name?: string | null; website?: string | null } | null;
  /** A few postings' text. */
  postingTexts: string[];
}

export interface LinkDecision { status: LinkStatus; method: LinkMethod | null; evidence: Record<string, unknown> }

export function decideLink(i: LinkEvidenceInput): LinkDecision {
  const { company, board } = i;
  const domain = websiteDomain(company.website);
  const generic = isGenericSlug(board.token);
  const ev = (o: Record<string, unknown>) => ({ slug: board.token, generic_slug: generic, ...o });

  // 1. The company's own site links to this very board.
  if (i.siteBoards?.some((r) => r.provider === board.provider && r.token === board.token)) {
    return { status: "verified", method: "website_link", evidence: ev({ page: i.sitePage ?? company.website }) };
  }
  // 2. The board names a website: the same domain verifies, another one refutes.
  const boardDomain = websiteDomain(i.boardMeta?.website ?? null);
  if (boardDomain && domain) {
    return sameSite(boardDomain, domain)
      ? { status: "verified", method: "domain_match", evidence: ev({ board_website: i.boardMeta?.website }) }
      : { status: "mismatch", method: "domain_match", evidence: ev({ board_website: i.boardMeta?.website, company_website: company.website }) };
  }
  // 3. The site links to a DIFFERENT board: this one is not theirs.
  if (i.siteBoards && i.siteBoards.length > 0) {
    return { status: "mismatch", method: "website_link", evidence: ev({ page: i.sitePage ?? company.website, site_links_to: i.siteBoards.map((r) => `${r.provider}/${r.token}`) }) };
  }
  // 4. A generic slug needs 1 or 2.
  if (generic) return { status: "unverifiable", method: null, evidence: ev({ reason: "generic slug: needs a link from the company's site or a matching domain" }) };
  // 5. The board's company name.
  const boardName = i.boardMeta?.name?.trim();
  if (boardName) {
    return namesMatch(boardName, company.name)
      ? { status: "verified", method: "name_match", evidence: ev({ board_name: boardName }) }
      : { status: "mismatch", method: "name_match", evidence: ev({ board_name: boardName, company: company.name }) };
  }
  // 6. The postings name the company (its domain, or its own distinctive name).
  const mentions = i.postingTexts.filter((t) => {
    const low = t.toLowerCase();
    return (domain && low.includes(domain)) || (isDistinctiveName(company.name) && new RegExp(`\\b${escapeRe(company.name.toLowerCase())}\\b`).test(low));
  }).length;
  if (mentions >= Math.min(2, i.postingTexts.length) && mentions > 0) {
    return { status: "verified", method: "content_match", evidence: ev({ postings_naming_company: mentions, postings_read: i.postingTexts.length }) };
  }
  return { status: "unverifiable", method: null, evidence: ev({ reason: "no site link, no board website or name, postings do not name the company", postings_read: i.postingTexts.length }) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Fetching (public pages and public ATS APIs) ──────────────────────────────

const TIMEOUT_MS = 15_000;
type Fetch = typeof fetch;

async function get(f: Fetch, url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  try {
    const res = await f(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/** A page through Jina Reader, as markdown WITH its links (lib's reader strips them). */
export async function readPage(f: Fetch, url: string, jinaKey?: string): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "text/plain", "X-With-Links-Summary": "true" };
  if (jinaKey) headers.Authorization = `Bearer ${jinaKey}`;
  const res = await get(f, `https://r.jina.ai/${url}`, headers);
  const text = res ? (await res.text()).trim() : "";
  return text || null;
}

/** The ATS boards a company's site links to: the home page, then its careers page. */
export async function boardsOnSite(f: Fetch, website: string, jinaKey?: string): Promise<{ boards: AtsRef[]; page: string } | null> {
  const home = website.startsWith("http") ? website : `https://${website}`;
  const md = await readPage(f, home, jinaKey);
  if (!md) return null;
  const onHome = atsLinksIn(md);
  if (onHome.length) return { boards: onHome, page: home };
  const careers = careersLinkIn(md, home);
  if (!careers) return { boards: [], page: home };
  const cmd = await readPage(f, careers, jinaKey);
  return { boards: cmd ? atsLinksIn(cmd) : [], page: careers };
}

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

/** What the ATS says about the board, and a few postings' text. Defensive: fields differ per provider. */
export async function boardFacts(f: Fetch, b: { provider: AtsProvider; token: string }): Promise<{ meta: LinkEvidenceInput["boardMeta"]; postings: string[]; exists: boolean }> {
  const t = encodeURIComponent(b.token);
  const firstUrl = (html: string | undefined) => html?.match(/https?:\/\/[^\s"'<>]+/g)?.find((u) => !/greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com/.test(u)) ?? null;
  switch (b.provider) {
    case "greenhouse": {
      const meta = await get(f, `https://boards-api.greenhouse.io/v1/boards/${t}`);
      const jobs = await get(f, `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`);
      const m = meta ? await meta.json().catch(() => null) as { name?: string; content?: string } | null : null;
      const j = jobs ? await jobs.json().catch(() => null) as { jobs?: Array<{ content?: string }> } | null : null;
      return { exists: !!jobs, meta: m ? { name: m.name ?? null, website: firstUrl(m.content) } : null,
        postings: (j?.jobs ?? []).slice(0, 5).map((x) => strip(decodeHtml(x.content ?? ""))) };
    }
    case "lever": {
      const res = await get(f, `https://api.lever.co/v0/postings/${t}?mode=json&limit=5`);
      const j = res ? await res.json().catch(() => null) as Array<{ descriptionPlain?: string; additionalPlain?: string }> | null : null;
      return { exists: !!res, meta: null, postings: (j ?? []).slice(0, 5).map((x) => `${x.descriptionPlain ?? ""} ${x.additionalPlain ?? ""}`) };
    }
    case "ashby": {
      const res = await get(f, `https://api.ashbyhq.com/posting-api/job-board/${t}`);
      const j = res ? await res.json().catch(() => null) as { jobs?: Array<{ descriptionPlain?: string }> } | null : null;
      return { exists: !!res, meta: null, postings: (j?.jobs ?? []).slice(0, 5).map((x) => x.descriptionPlain ?? "") };
    }
    case "workable": {
      const res = await get(f, `https://apply.workable.com/api/v1/widget/accounts/${t}`);
      const j = res ? await res.json().catch(() => null) as { name?: string; url?: string; website?: string; jobs?: Array<{ description?: string }> } | null : null;
      return { exists: !!res, meta: j ? { name: j.name ?? null, website: j.website ?? null } : null,
        postings: (j?.jobs ?? []).slice(0, 5).map((x) => strip(x.description ?? "")) };
    }
  }
}

function decodeHtml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// ── One batch ────────────────────────────────────────────────────────────────

export interface BoardDeps {
  db: SupabaseClient;
  fetch?: Fetch;
  jinaKey?: string;
  log?: (m: string) => void;
}

export interface BatchResult { checked: number; verified: number; mismatch: number; unverifiable: number; scanned: number; registered: number }

/** A few boards checked, or, when none is waiting, a few company sites read for boards. */
export async function boardsBatch(d: BoardDeps, size = 3): Promise<BatchResult> {
  const f = d.fetch ?? fetch;
  const log = d.log ?? ((m: string) => console.log(`[worker] boards: ${m}`));
  const r: BatchResult = { checked: 0, verified: 0, mismatch: 0, unverifiable: 0, scanned: 0, registered: 0 };

  const { data: boards, error } = await d.db.rpc("claim_board_links", { p_limit: size });
  if (error) throw new Error(`claim_board_links: ${error.message}`);
  for (const b of (boards ?? []) as Array<{ id: string; ats_provider: AtsProvider; ats_board_token: string; startup_id: string; startup_name: string; website: string | null }>) {
    const site = b.website ? await boardsOnSite(f, b.website, d.jinaKey) : null;
    const facts = await boardFacts(f, { provider: b.ats_provider, token: b.ats_board_token });
    const dec = decideLink({
      company: { name: b.startup_name, website: b.website },
      board: { provider: b.ats_provider, token: b.ats_board_token },
      siteBoards: site?.boards ?? null, sitePage: site?.page ?? null,
      boardMeta: facts.meta, postingTexts: facts.postings,
    });
    const { error: e } = await d.db.rpc("record_board_link", { p_id: b.id, p_status: dec.status, p_method: dec.method, p_evidence: dec.evidence });
    if (e) throw new Error(`record_board_link: ${e.message}`);
    r.checked++; r[dec.status]++;
    log(`${b.startup_name} ↔ ${b.ats_provider}/${b.ats_board_token}: ${dec.status}${dec.method ? ` (${dec.method})` : ""}`);
    // The site points to a board we did not have: register it, verified.
    for (const ref of site?.boards ?? []) {
      if (ref.provider === b.ats_provider && ref.token === b.ats_board_token) continue;
      if (await registerFromSite(d, f, b.startup_id, b.startup_name, ref, site!.page)) r.registered++;
    }
  }
  if (r.checked > 0) return r;

  const { data: scans, error: sErr } = await d.db.rpc("claim_board_site_scans", { p_limit: size });
  if (sErr) throw new Error(`claim_board_site_scans: ${sErr.message}`);
  for (const s of (scans ?? []) as Array<{ startup_id: string; startup_name: string; website: string }>) {
    r.scanned++;
    const site = await boardsOnSite(f, s.website, d.jinaKey);
    for (const ref of site?.boards ?? []) {
      if (await registerFromSite(d, f, s.startup_id, s.startup_name, ref, site!.page)) r.registered++;
    }
  }
  return r;
}

async function registerFromSite(d: BoardDeps, f: Fetch, startupId: string, name: string, ref: AtsRef, page: string): Promise<boolean> {
  // Only a board that really exists (a careers link can be stale).
  const facts = await boardFacts(f, ref);
  if (!facts.exists) return false;
  const { data, error } = await d.db.rpc("register_board_from_website", {
    p_startup_id: startupId, p_provider: ref.provider, p_token: ref.token, p_name: name,
    p_evidence: { page, link: ref.url },
  });
  if (error) throw new Error(`register_board_from_website: ${error.message}`);
  (d.log ?? console.log)(`[worker] boards: ${name}: its site links to ${ref.provider}/${ref.token} — ${data}`);
  return data === "registered" || data === "verified_existing";
}

/** One row per batch in source_runs, so the daily health check sees the work happening. */
export async function logBoardRun(db: SupabaseClient, r: BatchResult | null, error: string | null, startedAt: Date): Promise<void> {
  const rows = r ? r.verified + r.registered : 0;
  const status = error ? "error" : rows > 0 ? "ok" : "empty";
  const { error: e } = await db.from("source_runs").insert({
    source: "board_verify", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(),
    status, rows_in: rows, error, detail: r,
  });
  if (e) console.error(`[worker] boards: source_runs insert failed: ${e.message}`);
}
