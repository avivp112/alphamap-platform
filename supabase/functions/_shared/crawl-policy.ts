// =============================================================================
// _shared/crawl-policy.ts — how AlphaMap reads other people's sites (owner's
// decisions of 2026-10-24). Used by everything that fetches a job board or a
// company website: worker/boards.ts, sourcing-crawl, discover-boards.
//
//   * An honest User-Agent: the product, and a contact for site owners.
//   * robots.txt is read before every fetch, per site, and obeyed. A provider
//     whose data path its robots.txt disallows is switched off automatically
//     (ats_providers.enabled = false, migration 20261102000000) until a person
//     looks at it; a company website that disallows us is simply not read.
//   * What is stored stays minimal: a role's title, link, department and
//     location. Descriptions are read only to verify a board, never kept.
//
// Pure TypeScript (no Deno, no Node APIs), so both runtimes import it and
// vitest tests it.
// =============================================================================

/**
 * Who we are, in every request: the product and its site (owner, 2026-10-24:
 * no email). infoUrl stays empty until the owner gives the site's address —
 * then "AlphaMapBot/1.0" alone: never an address that is not ours.
 */
export const CRAWLER = {
  name: "AlphaMapBot",
  version: "1.0",
  /** The product's site (Vercel), e.g. "https://….vercel.app". */
  infoUrl: "",
};

export const crawlerUserAgent = (): string =>
  /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?$/.test(CRAWLER.infoUrl)
    ? `${CRAWLER.name}/${CRAWLER.version} (+${CRAWLER.infoUrl})`
    : `${CRAWLER.name}/${CRAWLER.version}`;

// ── robots.txt ───────────────────────────────────────────────────────────────

export interface RobotsRule { allow: boolean; pattern: string }

/**
 * The rules that apply to us: the groups naming our crawler, else the "*"
 * groups (RFC 9309). Comments and unknown lines are ignored.
 */
export function parseRobots(text: string, agent = CRAWLER.name): RobotsRule[] {
  const me = agent.toLowerCase();
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      // "Disallow:" with nothing after it allows everything — no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}

/** A robots.txt path pattern: "*" is any run of characters, a final "$" anchors the end. */
function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  return new RegExp("^" + body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
}

/** May we fetch this path (+ query)? The longest matching rule wins; a tie goes to allow. */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!toRegex(r.pattern).test(pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

export type RobotsVerdict = "allowed" | "disallowed" | "unknown";

/**
 * robots.txt, read once per site per run (and per day in a long-running
 * process). A missing robots.txt (4xx) allows everything; one that cannot be
 * read (5xx, timeout) is "unknown" — the fetch is skipped this time and
 * nothing is concluded from it.
 */
export class RobotsGate {
  private cache = new Map<string, { at: number; rules: Promise<RobotsRule[] | null> }>();
  constructor(
    private fetchFn: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>,
    private ttlMs = 24 * 3600_000,
  ) {}

  private rulesFor(origin: string): Promise<RobotsRule[] | null> {
    const hit = this.cache.get(origin);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.rules;
    const rules = (async () => {
      try {
        const res = await this.fetchFn(`${origin}/robots.txt`, {
          headers: { "User-Agent": crawlerUserAgent(), Accept: "text/plain" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status >= 400 && res.status < 500) return [];
        if (!res.ok) return null;
        return parseRobots(await res.text());
      } catch {
        return null;
      }
    })();
    this.cache.set(origin, { at: Date.now(), rules });
    return rules;
  }

  async check(url: string): Promise<RobotsVerdict> {
    let u: URL;
    try { u = new URL(url); } catch { return "disallowed"; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return "disallowed";
    const rules = await this.rulesFor(u.origin);
    if (rules === null) return "unknown";
    return robotsAllows(rules, u.pathname + u.search) ? "allowed" : "disallowed";
  }
}

/** The job-board provider a URL belongs to, if any. */
export function providerOfUrl(url: string): string | null {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (/(^|\.)greenhouse\.io$/.test(host)) return "greenhouse";
  if (/(^|\.)lever\.co$/.test(host)) return "lever";
  if (/(^|\.)ashbyhq\.com$/.test(host)) return "ashby";
  if (/(^|\.)workable\.com$/.test(host)) return "workable";
  if (/(^|\.)comeet\.(?:com|co)$/.test(host)) return "comeet";
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return "smartrecruiters";
  if (/(^|\.)teamtailor\.com$/.test(host)) return "teamtailor";
  if (/\.jobs\.personio\.(?:de|com)$/.test(host)) return "personio";
  if (/(^|\.)recruitee\.com$/.test(host)) return "recruitee";
  return null;
}

// ── What is kept of a role ───────────────────────────────────────────────────

/** The only fields of a posting AlphaMap stores (besides its id and lifecycle). */
export const STORED_POSTING_FIELDS = ["title", "url", "department", "location"] as const;
