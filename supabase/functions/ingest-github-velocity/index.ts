// =============================================================================
// Supabase Edge Function: ingest-github-velocity
//
// Layer 2. A repository is often the first public artefact a company has —
// before the domain, the incorporation, the Form D. What separates a forming
// company from a weekend project is the SHAPE of the growth: young, fast, and
// owned by nobody you have heard of.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          GITHUB_TOKEN (REQUIRED — see below)
//
// Deploy:  supabase functions deploy ingest-github-velocity --no-verify-jwt
// Invoke:  POST {}                              -> AI/dev repos created in the
//                                                   last 180 days, 25+ stars
//          POST { "minStars": 100 }
//          POST { "maxAgeDays": 90 }
//          POST { "topics": ["llm","agent"] }
//          POST { "withProfiles": true }        -> also fetch owner profiles
//          POST { "dryRun": true }
//
// ── GITHUB_TOKEN IS REQUIRED ────────────────────────────────────────────────
// Unauthenticated search is 10 requests/minute, which is unusable. A classic
// token with NO scopes is enough — this only reads public data, and a scopeless
// token cannot do anything else if it leaks:
//
//   supabase secrets set GITHUB_TOKEN="ghp_..."
//
// Authenticated search is 30 requests/minute; REQUEST_DELAY_MS holds under it.
//
// ── THE FIRST RUN PRODUCES NO VELOCITY ──────────────────────────────────────
// GitHub returns stargazers_count, a LEVEL. Star velocity is a difference
// between two measurements taken at different times, and GitHub exposes no
// history (the stargazers timestamp API is paginated per-user and would cost
// hundreds of requests per repo). So run one is a baseline with NULL rates.
// Schedule it daily; that is the entire point of the metrics table.
//
// ── EXCLUDING BIG TECH ──────────────────────────────────────────────────────
// Two filters, doing different jobs:
//   * oss_excluded_owners — identity. Google cannot be a startup, at any size.
//   * repo age            — stage. Meta's new repo is still not a startup, but
//                           a 2015 repo trending today is a project having a
//                           moment, not a company forming.
// Neither is a quality filter. A 40,000-star repo from a two-person org stays.
//
// ── ON EMAILS, WHICH THE BRIEF ASKED FOR ────────────────────────────────────
// Owner PROFILE fields are collected: login, display name, blog/website,
// company, and the public email field where the user set one. Those are things
// a person chose to publish.
//
// Commit-metadata emails are NOT collected, despite being technically
// reachable. They are exposed as a by-product of how git records authorship,
// not as a decision to publish a contact address, and GitHub's Acceptable Use
// Policies prohibit using information from the service to send unsolicited
// email or to sell personal information. Anyone who wants to be reachable sets
// the profile field, which we do read — so the cost of this line is close to
// zero and it keeps the pipeline on the right side of the platform's terms.
//
// ── VERIFICATION STATUS ─────────────────────────────────────────────────────
// The sandbox blocks outbound HTTPS, so the fetch path is unexercised. Pure
// logic — query construction, mapping, filters, profile extraction — is tested
// in oss.test.mjs against GitHub's documented response shapes. Run dryRun first.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://api.github.com";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;
const PAGE_SIZE = 100;
// Authenticated search allows 30/minute. 2.2s keeps us at ~27.
const REQUEST_DELAY_MS = 2200;
const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_AGE_DAYS = 180;
const DEFAULT_MIN_STARS = 25;
// GitHub's search API rejects a query with more than 5 boolean operators
// (AND/OR/NOT) with a 422, and separately caps query length at 256 chars.
// 13 topics OR-ed into one clause hits both: 12 operators, ~280+ chars. 5
// topics per chunk keeps every chunk at 4 operators and comfortably under
// the length cap regardless of topic name length.
const TOPICS_PER_QUERY = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Topics that mark the AI / developer-infrastructure space we care about. */
export const DEFAULT_TOPICS = [
  "llm", "agents", "ai-agents", "generative-ai", "rag", "vector-database",
  "machine-learning", "deep-learning", "inference", "fine-tuning",
  "developer-tools", "robotics", "computer-vision",
];

// ── Pure mapping ────────────────────────────────────────────────────────────

export interface Repo {
  externalId: string;      // "owner/name"
  owner: string;
  ownerType: string;       // 'User' | 'Organization'
  name: string;
  url: string;
  homepage: string | null;
  description: string | null;
  createdAt: string | null;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  language: string | null;
  topics: string[];
  isFork: boolean;
  isArchived: boolean;
}

export function mapRepo(rec: Record<string, unknown>): Repo | null {
  const externalId = String(rec?.full_name ?? "").trim();
  if (!externalId || !externalId.includes("/")) return null;
  const owner = (rec?.owner ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    externalId,
    owner: String(owner?.login ?? externalId.split("/")[0]),
    ownerType: String(owner?.type ?? "Organization"),
    name: String(rec?.name ?? externalId.split("/")[1] ?? ""),
    url: String(rec?.html_url ?? `https://github.com/${externalId}`),
    homepage: (rec?.homepage as string) || null,
    description: (rec?.description as string) ?? null,
    createdAt: (rec?.created_at as string) ?? null,
    stars: num(rec?.stargazers_count),
    forks: num(rec?.forks_count),
    openIssues: num(rec?.open_issues_count),
    language: (rec?.language as string) ?? null,
    topics: Array.isArray(rec?.topics) ? (rec!.topics as unknown[]).map(String) : [],
    isFork: rec?.fork === true,
    isArchived: rec?.archived === true,
  };
}

export interface OwnerProfile {
  login: string;
  name: string | null;
  profile_url: string;
  website: string | null;
  email: string | null;      // the PROFILE field only — never commit metadata
  company: string | null;
  bio: string | null;
  twitter: string | null;
  account_created_at: string | null;
}

/**
 * Owner profile, published fields only.
 *
 * `email` is GitHub's public profile email — null unless the user explicitly
 * set one. See the header on why commit-metadata emails are not gathered.
 */
export function mapOwnerProfile(rec: Record<string, unknown>): OwnerProfile | null {
  const login = String(rec?.login ?? "").trim();
  if (!login) return null;
  const s = (k: string): string | null => {
    const v = rec?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return {
    login,
    name: s("name"),
    profile_url: String(rec?.html_url ?? `https://github.com/${login}`),
    website: s("blog"),
    email: s("email"),
    company: s("company"),
    bio: s("bio"),
    twitter: s("twitter_username"),
    account_created_at: s("created_at"),
  };
}

/**
 * Links a founder has published in their bio or profile.
 *
 * Discord invites and personal sites are the two things that most often lead
 * to a company that has no other public footprint yet.
 */
export function extractLinks(profile: OwnerProfile | null, repo: Repo): string[] {
  const text = [profile?.bio, profile?.website, repo.description, repo.homepage].filter(Boolean).join(" ");
  const out: string[] = [];
  const push = (u: string) => { if (u && !out.includes(u)) out.push(u); };
  for (const m of text.matchAll(/https?:\/\/[^\s,)"'<>]+/gi)) push(m[0].replace(/[.,;]+$/, ""));
  for (const m of text.matchAll(/\b(?:discord\.gg|discord\.com\/invite)\/[A-Za-z0-9]+/gi)) push(`https://${m[0]}`);
  return out;
}

export const ageDays = (createdAt: string | null, now = Date.now()): number | null => {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null;
};

/** ISO date `maxAgeDays` before now, for the `created:>` qualifier. */
export const sinceDate = (maxAgeDays: number, now = Date.now()): string =>
  new Date(now - maxAgeDays * 86_400_000).toISOString().slice(0, 10);

/**
 * GitHub search query for ONE chunk of topics.
 *
 * Topics within a chunk are OR-ed together; the caller is responsible for
 * keeping each chunk at or under TOPICS_PER_QUERY (see its comment for why —
 * GitHub's search API 422s past 5 boolean operators or 256 characters, and
 * this function does not itself validate the chunk it's given).
 */
export function buildQuery(opts: {
  topics: string[]; minStars: number; maxAgeDays: number; now?: number;
}): string {
  const parts = [
    `created:>${sinceDate(opts.maxAgeDays, opts.now)}`,
    `stars:>=${opts.minStars}`,
    "is:public",
    "archived:false",
  ];
  if (opts.topics.length) parts.push(`(${opts.topics.map((t) => `topic:${t}`).join(" OR ")})`);
  return parts.join(" ");
}

/** Splits an array into chunks of at most `size` elements each. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function searchUrl(q: string, page: number, perPage = PAGE_SIZE): string {
  const p = new URLSearchParams({ q, sort: "stars", order: "desc", per_page: String(perPage), page: String(page) });
  return `${API}/search/repositories?${p.toString()}`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);

  const token = Deno.env.get("GITHUB_TOKEN")?.trim();
  if (!token) {
    return json({
      error: "GITHUB_TOKEN is not set. Unauthenticated search is 10 requests/minute, which cannot do useful work.",
      fix: 'A classic token with NO scopes is enough — this reads only public data. supabase secrets set GITHUB_TOKEN="ghp_..."',
    }, 500);
  }

  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let minStars = DEFAULT_MIN_STARS;
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  let topics = DEFAULT_TOPICS;
  let withProfiles = false;
  let dryRun = false;
  try {
    const b = await req.json();
    const n = Number(b?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    const s = Number(b?.minStars);
    if (Number.isFinite(s) && s >= 0) minStars = Math.floor(s);
    const a = Number(b?.maxAgeDays);
    if (Number.isFinite(a) && a > 0) maxAgeDays = Math.floor(a);
    if (Array.isArray(b?.topics) && b.topics.length) topics = b.topics.map(String);
    withProfiles = b?.withProfiles === true;
    dryRun = b?.dryRun === true;
  } catch { /* defaults */ }

  const gh = (url: string) => fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "AlphaMap-Sourcing/1.0",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  try {
    const { data: denied } = await supabase.from("oss_excluded_owners").select("owner_login");
    const denyset = new Set((denied ?? []).map((r: { owner_login: string }) => r.owner_login.toLowerCase()));

    // One query per chunk, not one query for all topics — see TOPICS_PER_QUERY.
    const topicChunks = chunk(topics, TOPICS_PER_QUERY);
    const keptByRepo = new Map<string, Repo>();
    let scanned = 0;
    const queries: Array<{ query: string; totalHits: number | null }> = [];
    const rejected: Record<string, number> = {};
    const reject = (why: string) => { rejected[why] = (rejected[why] ?? 0) + 1; };

    for (const topicChunk of topicChunks) {
      if (keptByRepo.size >= limit) break;

      const q = buildQuery({ topics: topicChunk, minStars, maxAgeDays });
      let page = 1;
      let chunkTotalHits: number | null = null;

      // GitHub search caps at 1000 results (10 pages) regardless of hit count.
      while (keptByRepo.size < limit && page <= 10) {
        const res = await gh(searchUrl(q, page));
        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            return json({ error: "GitHub rate limit or forbidden", status: res.status, query: q,
              hint: "search allows 30 requests/minute authenticated; lower the limit or wait" }, 502);
          }
          return json({ error: `GitHub returned ${res.status}`, query: q }, 502);
        }
        const body = await res.json() as Record<string, unknown>;
        chunkTotalHits = chunkTotalHits ?? Number(body?.total_count ?? 0);
        const items = Array.isArray(body?.items) ? (body!.items as Record<string, unknown>[]) : [];
        if (items.length === 0) break;

        for (const rec of items) {
          scanned++;
          const r = mapRepo(rec);
          if (!r) { reject("unmappable"); continue; }
          // A fork's stars belong to whoever it was forked from.
          if (r.isFork) { reject("fork"); continue; }
          if (r.isArchived) { reject("archived"); continue; }
          if (denyset.has(r.owner.toLowerCase())) { reject("excluded_owner"); continue; }
          const age = ageDays(r.createdAt);
          if (age !== null && age > maxAgeDays) { reject("too_old"); continue; }
          // A repo matching topics in two different chunks (e.g. both "llm"
          // and "agents") would otherwise be counted and ingested twice.
          if (keptByRepo.has(r.externalId)) { reject("duplicate_across_chunks"); continue; }
          keptByRepo.set(r.externalId, r);
          if (keptByRepo.size >= limit) break;
        }

        page++;
        if (items.length < PAGE_SIZE) break;
        await sleep(REQUEST_DELAY_MS);
      }

      queries.push({ query: q, totalHits: chunkTotalHits });
      if (topicChunks.indexOf(topicChunk) < topicChunks.length - 1) await sleep(REQUEST_DELAY_MS);
    }

    const kept = [...keptByRepo.values()];

    if (kept.length === 0) {
      return json({ queries, scanned, rejected, recorded: 0, note: "nothing matched — widen maxAgeDays or lower minStars" });
    }

    if (dryRun) {
      return json({
        queries, dryRun: true, scanned, rejected, wouldRecord: kept.length,
        sample: kept.slice(0, 25).map((r) => ({
          id: r.externalId, ownerType: r.ownerType, stars: r.stars,
          ageDays: ageDays(r.createdAt)?.toFixed(0) ?? null, language: r.language, topics: r.topics.slice(0, 6),
        })),
      });
    }

    // Owner profiles are one extra request each, so they are opt-in. Unique
    // owners only — several repos often share one.
    const profiles = new Map<string, OwnerProfile | null>();
    if (withProfiles) {
      for (const owner of [...new Set(kept.map((r) => r.owner))]) {
        await sleep(REQUEST_DELAY_MS / 4);   // core API allows 5000/hour
        try {
          const res = await gh(`${API}/users/${encodeURIComponent(owner)}`);
          profiles.set(owner, res.ok ? mapOwnerProfile(await res.json()) : null);
        } catch { profiles.set(owner, null); }
      }
    }

    const results: Array<Record<string, unknown>> = [];
    let created = 0;
    let withVelocity = 0;

    for (const r of kept) {
      const profile = profiles.get(r.owner) ?? null;
      const authors = profile ? [{ ...profile, links: extractLinks(profile, r) }] : [];

      const { data, error } = await supabase.rpc("record_oss_observation", {
        p_source: "github_repo",
        p_external_id: r.externalId,
        p_owner_login: r.owner,
        p_name: r.name,
        p_url: r.url,
        p_description: r.description,
        p_homepage: r.homepage,
        p_owner_type: r.ownerType.toLowerCase() === "user" ? "user" : "organization",
        p_tags: r.topics,
        p_primary_language: r.language,
        p_created_at_source: r.createdAt,
        p_authors: authors,
        p_stars: r.stars,
        p_forks: r.forks,
        p_open_issues: r.openIssues,
      });
      if (error) { results.push({ id: r.externalId, ok: false, reason: error.message }); continue; }
      const d = data as { created?: boolean; has_velocity?: boolean };
      if (d?.created) created++;
      if (d?.has_velocity) withVelocity++;
      results.push({ id: r.externalId, ok: true, stars: r.stars, ...d });
    }

    return json({
      queries, scanned, rejected,
      recorded: results.filter((r) => r.ok).length,
      newProjects: created,
      withVelocity,
      note: withVelocity === 0
        ? "baseline run — one observation each, so velocity is NULL. Run again tomorrow."
        : `${withVelocity} repos now have two or more observations`,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed" }, 500);
  }
});
