/**
 * lib/enrichment/update.ts — MODE=update: re-checking companies that are
 * already enriched, at a fraction of a full run's cost.
 *
 * A full run searches ~16 queries and sends everything to Claude. An update
 * only asks "what is new since the last check?":
 *
 *   - isUpdateDue(): an active company (a round in the last 18 months, or
 *     news in the last 6) is re-checked every ACTIVE_DAYS (30); a quiet one
 *     every QUIET_DAYS (90).
 *   - buildUpdateQueries(): two searches restricted to results published
 *     after the last check — company news, and funding/M&A/leadership
 *     changes — plus one search per core field still missing (founders, HQ,
 *     founding year, funding history), at most once every GAP_RETRY_DAYS.
 *   - newResultsOnly(): drops every URL already known for the company (news
 *     and round sources on file, field_provenance sources, and every URL
 *     earlier runs sent to Claude — see SeenUrls). When nothing new is left,
 *     the company is stamped as checked and Claude is never called.
 *
 * What gets written goes through the same rules as a full run: scalars are
 * fill-only unless a better-ranked source disagrees, a new round is a new
 * row (total raised and latest valuation are recomputed from the rounds),
 * a contradicting round is reported, never overwritten, and lists are
 * additive. An update additionally retires a C-level leader replaced by a
 * newly announced one ("Former CEO") — see retireReplacedExecutives().
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { normalizeUrlForMatch } from "./extractMarket";
import { samePersonName } from "./linkedin";

export const ACTIVE_DAYS = 30;
export const QUIET_DAYS = 90;
export const GAP_RETRY_DAYS = 90;

const DAY = 86_400_000;

export interface UpdateCandidate {
  last_enriched_at: string | null;
  news?: Array<{ published_date?: string | null } | null> | null;
}

/** True when the company is active: a round in the last 18 months or news in the last 6. */
export function isActiveCompany(row: UpdateCandidate, roundDates: Array<string | null | undefined>, now = Date.now()): boolean {
  const within = (iso: string | null | undefined, days: number) => !!iso && now - new Date(iso).getTime() <= days * DAY;
  return roundDates.some((d) => within(d, 548)) || (row.news ?? []).some((n) => within(n?.published_date, 183));
}

export function isUpdateDue(
  row: UpdateCandidate,
  roundDates: Array<string | null | undefined>,
  opts: { activeDays?: number; quietDays?: number; now?: number } = {},
): boolean {
  if (!row.last_enriched_at) return false; // never enriched: that is a full run's job
  const now = opts.now ?? Date.now();
  const interval = isActiveCompany(row, roundDates, now) ? (opts.activeDays ?? ACTIVE_DAYS) : (opts.quietDays ?? QUIET_DAYS);
  return now - new Date(row.last_enriched_at).getTime() >= interval * DAY;
}

export interface GapRow {
  founders?: unknown[] | null;
  city?: string | null;
  country?: string | null;
  founded_year?: number | null;
}

export interface UpdateQuery { label: string; query: string; kind: "web" | "news" }

/**
 * The searches for one update. `since` is the last check's date (YYYY-MM-DD);
 * Google's after: operator limits results to pages published after it.
 */
export function buildUpdateQueries(
  name: string,
  anchor: string,
  since: string,
  gaps: { row: GapRow; hasRounds: boolean } | null,
): UpdateQuery[] {
  const q: UpdateQuery[] = [
    { label: "update_news", kind: "news", query: `"${name}"${anchor} after:${since}` },
    {
      label: "update_changes", kind: "web",
      query: `"${name}"${anchor} (raises OR raised OR funding OR "Series" OR acquires OR acquired OR appoints OR "new CEO" OR IPO OR layoffs) after:${since}`,
    },
  ];
  if (gaps) {
    if (!gaps.row.founders || gaps.row.founders.length === 0) q.push({ label: "gap_founders", kind: "web", query: `"${name}"${anchor} founder co-founder CEO` });
    if (!gaps.row.city || !gaps.row.country || gaps.row.founded_year == null) q.push({ label: "gap_overview", kind: "web", query: `"${name}"${anchor} headquarters founded` });
    if (!gaps.hasRounds) q.push({ label: "gap_funding", kind: "web", query: `"${name}"${anchor} raised funding round investors "led by"` });
  }
  return q;
}

export interface KnownUrlInput {
  news?: Array<{ url?: string | null } | null> | null;
  roundSourceUrls?: Array<string | null | undefined>;
  provenanceUrls?: Array<string | null | undefined>;
  seen?: Iterable<string>;
}

export function knownUrlSet(input: KnownUrlInput): Set<string> {
  const out = new Set<string>();
  const add = (u: string | null | undefined) => { if (u) out.add(normalizeUrlForMatch(u)); };
  for (const n of input.news ?? []) add(n?.url);
  for (const u of input.roundSourceUrls ?? []) add(u);
  for (const u of input.provenanceUrls ?? []) add(u);
  for (const u of input.seen ?? []) add(u);
  return out;
}

/** Results whose URL is not already known for this company. */
export function newResultsOnly<T extends { url: string }>(results: T[], known: Set<string>): T[] {
  const seenNow = new Set<string>();
  return results.filter((r) => {
    const key = normalizeUrlForMatch(r.url);
    if (known.has(key) || seenNow.has(key)) return false;
    seenNow.add(key);
    return true;
  });
}

const FUNDING_WORDS = /\b(rais(?:e|es|ed|ing)|funding|investment|invest(?:s|ed)|series [a-h]\b|seed round|pre-seed|valuation|valued at|acquir(?:e|es|ed|ing)|acquisition|ipo|went public|merger)\b/i;

/** Whether any of these sources could carry a round, valuation or acquisition. */
export function mentionsFunding(texts: string[]): boolean {
  return texts.some((t) => FUNDING_WORDS.test(t));
}

// ── Leadership changes ───────────────────────────────────────────────────

const C_LEVEL: Array<[RegExp, string]> = [
  [/\b(ceo|chief executive officer)\b/i, "ceo"],
  [/\b(cfo|chief financial officer)\b/i, "cfo"],
  [/\b(cto|chief technology officer)\b/i, "cto"],
  [/\b(coo|chief operating officer)\b/i, "coo"],
  [/\b(cmo|chief marketing officer)\b/i, "cmo"],
  [/\b(cro|chief revenue officer)\b/i, "cro"],
  [/\b(cpo|chief product officer)\b/i, "cpo"],
];
const APPOINTED = /\b(appointed|appoints|named|hired|joins|joined|promoted|takes over|took over|succeeds|succeeded|new ceo|new cfo|new cto|steps in)\b/i;

function cLevelKey(role: string | null | undefined): string | null {
  if (!role || /\bformer\b|\bex-|\binterim\b|\bdeputy\b|\bvice\b|\bassociate\b/i.test(role)) return null;
  return C_LEVEL.find(([re]) => re.test(role))?.[1] ?? null;
}

interface Leader { name: string; role: string; bio?: string | null }

/**
 * A newly announced C-level leader ("Ershad Kunnakkadan was appointed
 * CEO") replaces whoever held that role on file, who is kept as "Former
 * CEO" — never deleted, never left as a second current CEO. Only applies
 * when the new leader's bio or role says they were appointed, so a leader
 * merely mentioned in an article does not retire anyone.
 */
export function retireReplacedExecutives<T extends Leader>(onFile: T[], incoming: Leader[]): { leaders: T[]; retired: string[] } {
  const retired: string[] = [];
  const leaders = onFile.map((l) => ({ ...l }));
  for (const n of incoming) {
    const key = cLevelKey(n.role);
    if (!key || !APPOINTED.test(`${n.role} ${n.bio ?? ""}`)) continue;
    for (const l of leaders) {
      if (cLevelKey(l.role) === key && !samePersonName(l.name, n.name)) {
        retired.push(`${l.name} (${l.role})`);
        l.role = `Former ${l.role}`;
      }
    }
  }
  return { leaders, retired };
}

// ── URLs already sent to Claude, per company (local, like the search cache) ──

const SEEN_DIR = process.env.SEEN_URLS_DIR ?? join(process.cwd(), "cache", "enrich_v2_seen");

interface SeenFile { urls: string[]; lastGapFillAt?: string }

export class SeenUrls {
  private data: SeenFile = { urls: [] };
  private readonly file: string | null;
  constructor(companyId: string, dir: string | null = SEEN_DIR) {
    this.file = dir ? join(dir, `${companyId}.json`) : null;
    if (this.file && existsSync(this.file)) {
      try { this.data = JSON.parse(readFileSync(this.file, "utf8")) as SeenFile; } catch { this.data = { urls: [] }; }
    }
  }
  get urls(): string[] { return this.data.urls; }
  get lastGapFillAt(): string | undefined { return this.data.lastGapFillAt; }
  add(urls: string[]): void {
    const set = new Set(this.data.urls);
    for (const u of urls) set.add(normalizeUrlForMatch(u));
    this.data.urls = [...set].slice(-2000);
  }
  markGapFill(now = new Date()): void { this.data.lastGapFillAt = now.toISOString(); }
  gapFillDue(now = Date.now(), days = GAP_RETRY_DAYS): boolean {
    return !this.data.lastGapFillAt || now - new Date(this.data.lastGapFillAt).getTime() >= days * DAY;
  }
  save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data));
  }
}
