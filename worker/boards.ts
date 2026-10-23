// =============================================================================
// worker/boards.ts — is each job board really the company's? And which boards
// does a company's own website point to? (migration 20261027000000)
//
// discover-boards guesses a board's slug from the company's domain; this
// checks the guess, strongest evidence first (decideLink), and reads company
// websites for careers links to find the boards guessing missed.
//
// Only the company's own site or its domain verifies a board (rules v2,
// migration 20261028000000): its site links to the board, the board declares
// the company's website, or the postings give its domain. The name alone —
// the very thing the slug was guessed from — is low confidence at most, and
// never shown.
//
// Runs in the check worker between users' checks, a few boards at a time:
// it reads public pages and public ATS APIs, gently.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDistinctiveName } from "../lib/enrichment/entity.ts";
import { websiteDomain } from "../lib/enrichment/websiteValidation.ts";
import { comeetPage } from "../supabase/functions/sourcing-crawl/parse.ts";

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workable" | "comeet";
export interface AtsRef { provider: AtsProvider; token: string; url: string }

// ── Reading ATS links out of a page ──────────────────────────────────────────

const ATS_PATTERNS: Array<{ provider: AtsProvider; re: RegExp }> = [
  // The embed script and iframe: boards.greenhouse.io/embed/job_board/js?for=acme
  { provider: "greenhouse", re: /https?:\/\/(?:job-)?boards(?:\.eu)?\.greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\?(?:[^"'\s<>]*?&(?:amp;)?)?for=([a-z0-9_-]+)/gi },
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
  const page = unescapeUrls(text);
  for (const { provider, re } of ATS_PATTERNS) {
    for (const m of page.matchAll(re)) {
      const token = decodeURIComponent(m[1]).toLowerCase().replace(/[.,;)]+$/, "");
      if (!token || NOT_A_TOKEN.has(token)) continue;
      if (!out.some((r) => r.provider === provider && r.token === token)) out.push({ provider, token, url: m[0] });
    }
  }
  for (const ref of comeetLinksIn(page)) {
    if (!out.some((r) => r.provider === "comeet" && sameComeetBoard(r.token, ref.token))) out.push(ref);
  }
  return out;
}

// ── Comeet ───────────────────────────────────────────────────────────────────
// A Comeet board is "{slug}/{company_uid}" (comeet.com/jobs/sett/4A.00B). The
// uid cannot be guessed, so it is only ever found here, on a company's own
// site: a link to the hosted careers page, or the careers widget's settings.
// The uid keeps its case ("4A.00B"); the slug is lowercased.

const COMEET_UID = "[0-9A-Fa-f]{2}\\.[0-9A-Fa-f]{3}";
const COMEET_LINK = new RegExp(`https?://(?:www\\.)?comeet\\.(?:com|co)/jobs/([a-z0-9_.%-]+)/(${COMEET_UID})(?![0-9A-Za-z])`, "gi");
const COMEET_WIDGET_UID = new RegExp(`["']?company[-_]uid["']?\\s*[:=]\\s*["'](${COMEET_UID})["']`, "gi");
const COMEET_API_UID = new RegExp(`comeet\\.co(?:m)?/careers-api/[0-9.]+/company/(${COMEET_UID})`, "gi");
const COMEET_WIDGET_NAME = /["']?company[-_]name["']?\s*[:=]\s*["']([^"']{1,80})["']/i;

const comeetSlug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const comeetUid = (token: string) => token.split("/").pop()!.toUpperCase();
const sameComeetBoard = (a: string, b: string) => comeetUid(a) === comeetUid(b);

/** Comeet boards a page links to or embeds; a widget gives its uid, and its company name for the slug. */
export function comeetLinksIn(page: string): AtsRef[] {
  const out: AtsRef[] = [];
  const add = (slug: string, uid: string, url: string) => {
    const token = `${slug}/${uid.toUpperCase()}`;
    if (slug && !out.some((r) => sameComeetBoard(r.token, token))) out.push({ provider: "comeet", token, url });
  };
  for (const m of page.matchAll(COMEET_LINK)) add(decodeURIComponent(m[1]).toLowerCase(), m[2], m[0]);
  const widgetName = page.match(COMEET_WIDGET_NAME)?.[1];
  for (const re of [COMEET_WIDGET_UID, COMEET_API_UID]) {
    for (const m of page.matchAll(re)) {
      // the widget's own settings; a slug is needed for the hosted page's URL
      if (widgetName) add(comeetSlug(widgetName), m[1], `https://www.comeet.com/jobs/${comeetSlug(widgetName)}/${m[1].toUpperCase()}`);
    }
  }
  return out;
}

/** URLs as they appear inside scripts and JSON (https:\/\/...) and HTML attributes (&amp;). */
export function unescapeUrls(text: string): string {
  return text.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

/** Every link on a page, markdown ([text](url), from Jina) or HTML (<a href>, fetched directly); relative ones resolved. */
export function linksIn(page: string, base: string): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  const add = (text: string, href: string) => {
    try {
      const url = new URL(href.trim(), base).toString();
      if (/^https?:/.test(url)) out.push({ text: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), url });
    } catch { /* not a URL */ }
  };
  for (const m of page.matchAll(/\[([^\]]{0,80})\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1], m[2]);
  for (const m of page.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) add(m[2], unescapeUrls(m[1]));
  return out;
}

/** The careers page a home page links to, if any (same site only). */
export function careersLinkIn(page: string, site: string): string | null {
  const base = site.startsWith("http") ? site : `https://${site}`;
  const home = websiteDomain(site);
  for (const { text, url } of linksIn(page, base)) {
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

/**
 * verified        strong evidence: shown on the profile (the only status that is)
 * low_confidence  only the name agrees — the board was FOUND by that name, so
 *                 the name cannot confirm it (decision of 2026-10-22). Kept, never shown.
 * mismatch        evidence that the board is someone else's
 * unverifiable    no evidence either way
 */
export type LinkStatus = "verified" | "low_confidence" | "mismatch" | "unverifiable";
/** Strong: website_link, domain_match, posting_domain. Name only: name_match, content_match. */
export type LinkMethod = "website_link" | "domain_match" | "posting_domain" | "name_match" | "content_match";

/**
 * Raised when the rules change; boards checked under older rules are checked
 * again (migration 20261028000000). 3: a board website on another domain is
 * the company's own when one domain redirects to the other (redis.com ->
 * redis.io), 2026-10-23.
 */
export const LINK_RULES_VERSION = 3;

export interface LinkEvidenceInput {
  company: { name: string; website: string | null };
  board: { provider: AtsProvider; token: string };
  /** ATS boards the company's own site links to; null when the site could not be read. */
  siteBoards: AtsRef[] | null;
  /** The page those links were found on. */
  sitePage?: string | null;
  /**
   * What the ATS says about the board itself, where it says anything.
   * website: the company website the board itself declares (Workable's
   * website, Ashby's publicWebsite, Lever's header logo link) — it can verify
   * or refute. linkedDomains: sites the board's free-text intro links to
   * (Greenhouse) — they can verify, never refute (an intro links to partners
   * and investors too).
   */
  boardMeta: { name?: string | null; website?: string | null; linkedDomains?: string[] } | null;
  /** A few postings' text. */
  postingTexts: string[];
  /**
   * When the board's website is on another domain: where each of the two
   * domains ends up after redirects ({ [domain]: final domain }). Only a
   * redirect from one of the two straight to the other makes them one site.
   */
  redirects?: Record<string, string | null>;
}

export interface LinkDecision { status: LinkStatus; method: LinkMethod | null; evidence: Record<string, unknown> }

/** The domain as a whole word: "acme.com" in "careers@acme.com", not in "notacme.com". */
const mentionsDomain = (text: string, domain: string) =>
  new RegExp(`(^|[^a-z0-9-])${escapeRe(domain)}($|[^a-z0-9-])`).test(text.toLowerCase());

export function decideLink(i: LinkEvidenceInput): LinkDecision {
  const { company, board } = i;
  const domain = websiteDomain(company.website);
  const generic = isGenericSlug(board.provider === "comeet" ? board.token.split("/")[0] : board.token);
  const ev = (o: Record<string, unknown>) => ({ slug: board.token, generic_slug: generic, rules: LINK_RULES_VERSION, ...o });

  // ── Strong evidence: the company's own site, or its domain ──────────────────
  // 1. The company's own site links to this very board.
  if (i.siteBoards?.some((r) => r.provider === board.provider && (r.token === board.token || (board.provider === "comeet" && sameComeetBoard(r.token, board.token))))) {
    return { status: "verified", method: "website_link", evidence: ev({ page: i.sitePage ?? company.website }) };
  }
  // 2. The board declares a website: the same domain verifies, another one refutes.
  const boardDomain = websiteDomain(i.boardMeta?.website ?? null);
  if (boardDomain && domain) {
    if (sameSite(boardDomain, domain)) return { status: "verified", method: "domain_match", evidence: ev({ board_website: i.boardMeta?.website }) };
    // One company, two domains: one redirects to the other. Never "both end up
    // at the same third place" — two parked domains do that too.
    const theirs = i.redirects?.[boardDomain], ours = i.redirects?.[domain];
    if ((theirs && sameSite(theirs, domain)) || (ours && sameSite(ours, boardDomain))) {
      return { status: "verified", method: "domain_match", evidence: ev({ board_website: i.boardMeta?.website, redirect: theirs && sameSite(theirs, domain) ? `${boardDomain} -> ${theirs}` : `${domain} -> ${ours}` }) };
    }
    return { status: "mismatch", method: "domain_match", evidence: ev({ board_website: i.boardMeta?.website, company_website: company.website }) };
  }
  //    ...or its intro links to the company's site (verifies only).
  const linked = domain ? (i.boardMeta?.linkedDomains ?? []).find((d) => sameSite(d, domain)) : undefined;
  if (linked) return { status: "verified", method: "domain_match", evidence: ev({ board_links_to: linked }) };
  // 3. The site links to a DIFFERENT board: this one is not theirs.
  if (i.siteBoards && i.siteBoards.length > 0) {
    return { status: "mismatch", method: "website_link", evidence: ev({ page: i.sitePage ?? company.website, site_links_to: i.siteBoards.map((r) => `${r.provider}/${r.token}`) }) };
  }
  // 4. A generic slug needs 1 or 2 (the owner's rule of 2026-10-21).
  if (generic) return { status: "unverifiable", method: null, evidence: ev({ reason: "generic slug: needs a link from the company's site or a matching domain" }) };
  // 5. The postings give the company's domain (an email, an apply link, "visit acme.com").
  const withDomain = domain ? i.postingTexts.filter((t) => mentionsDomain(t, domain)).length : 0;
  if (withDomain > 0 && withDomain >= Math.min(2, i.postingTexts.length)) {
    return { status: "verified", method: "posting_domain", evidence: ev({ postings_with_domain: withDomain, postings_read: i.postingTexts.length, domain }) };
  }

  // ── The name only: never verifies ───────────────────────────────────────────
  // 6. The board's company name: another name refutes; the same name is low confidence.
  const boardName = i.boardMeta?.name?.trim();
  if (boardName && !namesMatch(boardName, company.name)) {
    return { status: "mismatch", method: "name_match", evidence: ev({ board_name: boardName, company: company.name }) };
  }
  if (!isDistinctiveName(company.name)) {
    return { status: "unverifiable", method: null, evidence: ev({ reason: "the name is not distinctive and nothing stronger was found", postings_read: i.postingTexts.length }) };
  }
  if (boardName) return { status: "low_confidence", method: "name_match", evidence: ev({ board_name: boardName }) };
  // 7. The postings name the company.
  const named = i.postingTexts.filter((t) => new RegExp(`\\b${escapeRe(company.name.toLowerCase())}\\b`).test(t.toLowerCase())).length;
  if (named > 0 && named >= Math.min(2, i.postingTexts.length)) {
    return { status: "low_confidence", method: "content_match", evidence: ev({ postings_naming_company: named, postings_read: i.postingTexts.length }) };
  }
  return { status: "unverifiable", method: null, evidence: ev({ reason: "no site link, no board website, postings name neither the domain nor the company", postings_read: i.postingTexts.length }) };
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

const BROWSER_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; AlphaMapBot/1.0; +https://alphamap.app)", Accept: "text/html,application/xhtml+xml" };

/** A page's own HTML — every href, iframe and embed script, which a reader's markdown can drop. */
export async function fetchHtml(f: Fetch, url: string): Promise<string | null> {
  const res = await get(f, url, BROWSER_HEADERS);
  if (!res || !/html|text\/plain/i.test(res.headers.get("content-type") ?? "text/html")) return null;
  const text = (await res.text()).slice(0, 2_000_000);
  return text.trim() || null;
}

/**
 * A page, for its links: its own HTML first (free, and it keeps the embed
 * scripts an ATS is wired in with); Jina, which runs the page's JavaScript,
 * when the HTML lacks what is looked for — any link on a home page, an ATS
 * link on a careers page. A guessed path that does not answer is not read
 * through Jina (guessed: true).
 */
export async function readForLinks(f: Fetch, url: string, jinaKey?: string, o: { wantAts?: boolean; guessed?: boolean } = {}): Promise<string | null> {
  const html = await fetchHtml(f, url);
  if (html && atsLinksIn(html).length) return html;
  if (html && !o.wantAts && linksIn(html, url).length) return html;
  if (!html && o.guessed) return null;
  return (await readPage(f, url, jinaKey)) ?? html;
}

/** Where companies usually keep the careers page, tried when the home page does not link to one. */
const CAREERS_PATHS = ["/careers", "/jobs"];

/** The ATS boards a company's site links to: the home page, its careers page, then the usual careers paths. */
export async function boardsOnSite(f: Fetch, website: string, jinaKey?: string): Promise<{ boards: AtsRef[]; page: string } | null> {
  const home = website.startsWith("http") ? website : `https://${website}`;
  const page = await readForLinks(f, home, jinaKey);
  if (!page) return null;
  const onHome = atsLinksIn(page);
  if (onHome.length) return { boards: onHome, page: home };
  const tried = new Set<string>();
  const linked = careersLinkIn(page, home);
  const candidates = [
    ...(linked ? [{ url: linked, guessed: false }] : []),
    ...CAREERS_PATHS.flatMap((p) => { try { return [{ url: new URL(p, home).toString(), guessed: true }]; } catch { return []; } }),
  ];
  for (const { url, guessed } of candidates) {
    if (tried.has(url.replace(/\/$/, ""))) continue;
    tried.add(url.replace(/\/$/, ""));
    const c = await readForLinks(f, url, jinaKey, { wantAts: true, guessed });
    const boards = c ? atsLinksIn(c) : [];
    if (boards.length) return { boards, page: url };
  }
  return { boards: [], page: home };
}

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

// Links that say nothing about whose board it is.
const NOT_A_COMPANY_SITE = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|glassdoor\.[a-z.]+|github\.com|medium\.com|crunchbase\.com|google\.[a-z.]+|bit\.ly|eeoc\.gov|dol\.gov)$/i;

/** The company sites a board's free-text intro links to (Greenhouse's board "content"). */
export function linkedDomainsIn(html: string | null | undefined): string[] {
  const out: string[] = [];
  for (const u of unescapeUrls(decodeHtml(html ?? "")).match(/https?:\/\/[^\s"'<>)]+/g) ?? []) {
    const d = websiteDomain(u);
    if (d && !NOT_A_COMPANY_SITE.test(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

/** Lever's board page: the header logo links to the company's website. */
export function leverWebsite(html: string | null): string | null {
  for (const m of (html ?? "").matchAll(/<a\b[^>]*>/gi)) {
    if (!/class\s*=\s*["'][^"']*main-header-logo/i.test(m[0])) continue;
    const href = m[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href && /^https?:/i.test(href) && !NOT_A_COMPANY_SITE.test(websiteDomain(href) ?? "")) return href;
  }
  return null;
}

/** Ashby's board page carries the organisation's own website in its app data. */
export function ashbyWebsite(html: string | null): string | null {
  const href = unescapeUrls(html ?? "").match(/"publicWebsite"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  return href && !NOT_A_COMPANY_SITE.test(websiteDomain(href) ?? "") ? href : null;
}

/** What the ATS says about the board, and a few postings' text. Defensive: fields differ per provider. */
export async function boardFacts(f: Fetch, b: { provider: AtsProvider; token: string }): Promise<{ meta: LinkEvidenceInput["boardMeta"]; postings: string[]; exists: boolean }> {
  const t = encodeURIComponent(b.token);
  switch (b.provider) {
    case "greenhouse": {
      const meta = await get(f, `https://boards-api.greenhouse.io/v1/boards/${t}`);
      const jobs = await get(f, `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`);
      const m = meta ? await meta.json().catch(() => null) as { name?: string; content?: string } | null : null;
      const j = jobs ? await jobs.json().catch(() => null) as { jobs?: Array<{ content?: string }> } | null : null;
      return { exists: !!jobs, meta: m ? { name: m.name ?? null, linkedDomains: linkedDomainsIn(m.content) } : null,
        postings: (j?.jobs ?? []).slice(0, 5).map((x) => strip(decodeHtml(x.content ?? ""))) };
    }
    case "lever": {
      const res = await get(f, `https://api.lever.co/v0/postings/${t}?mode=json&limit=5`);
      const j = res ? await res.json().catch(() => null) as Array<{ descriptionPlain?: string; additionalPlain?: string }> | null : null;
      const website = res ? leverWebsite(await fetchHtml(f, `https://jobs.lever.co/${t}`)) : null;
      return { exists: !!res, meta: website ? { website } : null, postings: (j ?? []).slice(0, 5).map((x) => `${x.descriptionPlain ?? ""} ${x.additionalPlain ?? ""}`) };
    }
    case "ashby": {
      const res = await get(f, `https://api.ashbyhq.com/posting-api/job-board/${t}`);
      const j = res ? await res.json().catch(() => null) as { jobs?: Array<{ descriptionPlain?: string }> } | null : null;
      const website = res ? ashbyWebsite(await fetchHtml(f, `https://jobs.ashbyhq.com/${t}`)) : null;
      return { exists: !!res, meta: website ? { website } : null, postings: (j?.jobs ?? []).slice(0, 5).map((x) => x.descriptionPlain ?? "") };
    }
    case "comeet": {
      // the hosted careers page: COMPANY_DATA.website is the company's own
      // declaration; the positions' pages on the company's site verify too
      const page = comeetPage((await fetchHtml(f, `https://www.comeet.com/jobs/${b.token.split("/").map(encodeURIComponent).join("/")}`)) ?? "");
      if (!page) return { exists: false, meta: null, postings: [] };
      const positions = page.positions as Array<Record<string, unknown>>;
      const linkedDomains = [...new Set(positions.map((p) => websiteDomain(typeof p.url_active_page === "string" ? p.url_active_page : null))
        .filter((d): d is string => !!d && !/comeet\.(com|co)$/.test(d)))];
      const postings = positions.slice(0, 5).map((p) => strip(decodeHtml((Array.isArray(p.details) ? p.details : [])
        .map((d) => String((d as Record<string, unknown>)?.value ?? "")).join(" "))));
      return { exists: true, meta: { name: page.company.name, website: page.company.website, linkedDomains }, postings };
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

/** Where a domain's home page ends up after redirects (its final domain), or null. */
export async function finalDomain(f: Fetch, domain: string): Promise<string | null> {
  const res = await get(f, `https://${domain}`, BROWSER_HEADERS);
  return res?.url ? websiteDomain(res.url) : null;
}

/** Both domains' redirects — only when the board's website is on another domain than ours. */
async function redirectsBetween(f: Fetch, board: string | null, ours: string | null): Promise<Record<string, string | null> | undefined> {
  if (!board || !ours || sameSite(board, ours)) return undefined;
  const [a, b] = await Promise.all([finalDomain(f, board), finalDomain(f, ours)]);
  return { [board]: a, [ours]: b };
}

// ── One batch ────────────────────────────────────────────────────────────────

export interface BoardDeps {
  db: SupabaseClient;
  fetch?: Fetch;
  jinaKey?: string;
  log?: (m: string) => void;
}

export interface BatchResult { checked: number; verified: number; low_confidence: number; mismatch: number; unverifiable: number; scanned: number; registered: number }

/** A few boards checked, or, when none is waiting, a few company sites read for boards. */
export async function boardsBatch(d: BoardDeps, size = 3): Promise<BatchResult> {
  const f = d.fetch ?? fetch;
  const log = d.log ?? ((m: string) => console.log(`[worker] boards: ${m}`));
  const r: BatchResult = { checked: 0, verified: 0, low_confidence: 0, mismatch: 0, unverifiable: 0, scanned: 0, registered: 0 };

  const { data: boards, error } = await d.db.rpc("claim_board_links", { p_limit: size, p_rule_version: LINK_RULES_VERSION });
  if (error) throw new Error(`claim_board_links: ${error.message}`);
  for (const b of (boards ?? []) as Array<{ id: string; ats_provider: AtsProvider; ats_board_token: string; startup_id: string; startup_name: string; website: string | null }>) {
    const site = b.website ? await boardsOnSite(f, b.website, d.jinaKey) : null;
    const facts = await boardFacts(f, { provider: b.ats_provider, token: b.ats_board_token });
    const redirects = await redirectsBetween(f, websiteDomain(facts.meta?.website ?? null), websiteDomain(b.website));
    const dec = decideLink({
      company: { name: b.startup_name, website: b.website },
      board: { provider: b.ats_provider, token: b.ats_board_token },
      siteBoards: site?.boards ?? null, sitePage: site?.page ?? null,
      boardMeta: facts.meta, postingTexts: facts.postings, redirects,
    });
    const { error: e } = await d.db.rpc("record_board_link", { p_id: b.id, p_status: dec.status, p_method: dec.method, p_evidence: dec.evidence, p_rule_version: LINK_RULES_VERSION });
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
