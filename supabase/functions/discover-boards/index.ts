// =============================================================================
// Supabase Edge Function: discover-boards
//
// Turns companies in `startups` into crawlable ATS boards. This is the bridge
// that was missing: sourcing_companies could only ever be filled by hand, so
// the crawler had two boards to work with while `startups` held thousands.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
// Deploy:  supabase functions deploy discover-boards --no-verify-jwt
// Invoke:  POST { "limit": 10 }        -> attempt the next 10 candidates
//          POST { "dryRun": true }     -> report the slugs it WOULD probe and
//                                         change nothing. Worth running first.
//
// For each candidate company:
//   1. derive slug candidates from its website domain (and name as backup)
//   2. probe each slug against every ATS provider, stopping at the first hit
//   3. register the hit in sourcing_companies WITH startup_id set, so the
//      FOMO view can read founded_year for age scoring
//   4. stamp startups.board_discovery_at either way, so a company that has no
//      board is never retried on the next invocation
//
// ── REQUEST BUDGET, which is what bounds `limit` ────────────────────────────
// Worst case per company is (slug candidates x providers) requests — capped at
// 3 x 4 = 12 — but the loop stops at the first hit, so a company on Greenhouse
// under its obvious slug costs 1. Companies with no board cost the full 12,
// and most companies have no board. At ~0.3s per request that is ~4s per miss,
// so a limit of 10 sits comfortably inside the Edge Function timeout while 50
// would not. Cover more ground with a shorter cron interval, not a bigger
// batch.
//
// Deliberately NOT parallel: these are public endpoints belonging to other
// companies, and firing concurrent bursts at them is both rude and the fastest
// way to get rate-limited off.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_SLUG_CANDIDATES = 3;
const FETCH_TIMEOUT_MS = 12_000;

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workable";
export const ATS_PROVIDERS: AtsProvider[] = ["greenhouse", "lever", "ashby", "workable"];

// Kept in step with sourcing-crawl's registry. Only the first URL of each
// provider chain is used here — discovery just needs a yes/no.
const PROVIDER_URL: Record<AtsProvider, (t: string) => string> = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  lever:      (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby:      (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
  workable:   (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`,
};

// ── Pure slug derivation (unit-testable, no network) ────────────────────────

/**
 * Public suffixes we strip so "acme.co.uk" yields "acme" rather than
 * "acme.co". Not exhaustive — just the ones common enough to matter.
 */
const MULTI_PART_TLDS = [".co.uk", ".com.au", ".co.nz", ".co.il", ".com.br", ".co.jp", ".co.za"];

/**
 * Hosts that are never a company's own domain — a slug derived from these is
 * noise ("github", "wixsite") and would probe a board that cannot exist.
 * Matched as a SUFFIX, not by equality: the real-world form is
 * "acme.github.io", not bare "github.io".
 */
const HOSTING_DOMAINS = [
  "github.io", "herokuapp.com", "vercel.app", "netlify.app", "webflow.io",
  "wixsite.com", "squarespace.com", "notion.site", "carrd.co", "framer.website",
  "linkedin.com", "twitter.com", "x.com", "facebook.com", "crunchbase.com",
];

const isHostedElsewhere = (host: string): boolean =>
  HOSTING_DOMAINS.some((d) => host === d || host.endsWith("." + d));

/** "https://www.Glow-Security.com/careers?x=1" -> "glow-security.com" */
export function hostFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  let s = website.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split("/")[0].split("?")[0].split("#")[0].split("@").pop() ?? "";
  s = s.split(":")[0];
  s = s.replace(/^www\./, "").replace(/\.+$/, "");
  if (!s || !s.includes(".")) return null;
  return s;
}

/** "glow-security.com" -> "glow-security" (registrable label, TLD removed). */
export function domainLabel(host: string | null): string | null {
  if (!host) return null;
  let h = host;
  for (const t of MULTI_PART_TLDS) {
    if (h.endsWith(t)) { h = h.slice(0, -t.length); break; }
  }
  if (h === host) h = h.replace(/\.[a-z]{2,}$/, "");
  // Take the last label so "jobs.acme" -> "acme"; a subdomain is not the brand.
  const label = h.split(".").filter(Boolean).pop() ?? "";
  return label || null;
}

const slugify = (v: string): string =>
  v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
   .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-")
   .replace(/^-+|-+$/g, "");

/**
 * Candidate board slugs for a company, most-likely first, deduped and capped.
 *
 * Ordering matters because the probe loop stops at the first hit: the domain
 * label is by far the most common ATS slug, so it goes first and usually
 * costs a single request.
 */
export function slugCandidates(
  website: string | null | undefined,
  name: string | null | undefined,
  cap = MAX_SLUG_CANDIDATES,
): string[] {
  const out: string[] = [];
  const push = (v: string | null) => {
    if (!v) return;
    const s = v.trim();
    // One-character slugs match half the internet; not worth a request.
    if (s.length < 2) return;
    if (!out.includes(s)) out.push(s);
  };

  const host = hostFromWebsite(website);
  // A site on someone else's hosting tells us nothing about the company slug.
  if (host && !isHostedElsewhere(host)) {
    const label = domainLabel(host);
    push(label);
    // "glow-security" -> "glowsecurity": both spellings are used in practice.
    if (label && label.includes("-")) push(label.replace(/-/g, ""));
  }

  if (name) {
    const n = slugify(name);
    push(n);
    push(n.replace(/-/g, ""));
  }

  return out.slice(0, cap);
}

// ── Fetching ────────────────────────────────────────────────────────────────

interface Hit { ats_provider: AtsProvider; slug: string; jobs: number; }

function countJobs(provider: AtsProvider, data: unknown): number {
  if (provider === "lever") return Array.isArray(data) ? data.length : 0;
  const jobs = (data as { jobs?: unknown })?.jobs;
  return Array.isArray(jobs) ? jobs.length : 0;
}

async function probe(provider: AtsProvider, slug: string): Promise<number | null> {
  try {
    const res = await fetch(PROVIDER_URL[provider](encodeURIComponent(slug)), {
      headers: { Accept: "application/json", "User-Agent": "AlphaMap-Sourcing/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const text = await res.text();
    try {
      return countJobs(provider, JSON.parse(text));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * First provider/slug pair that returns a board with at least one job.
 *
 * Requiring jobs > 0 is deliberate. Workable answers 200 for accounts that do
 * not exist, so "responded successfully" is not evidence of a real board —
 * registering on that basis would fill sourcing_companies with phantoms.
 */
async function findBoard(slugs: string[]): Promise<{ hit: Hit | null; requests: number }> {
  let requests = 0;
  for (const slug of slugs) {
    for (const provider of ATS_PROVIDERS) {
      requests++;
      const jobs = await probe(provider, slug);
      if (jobs !== null && jobs > 0) return { hit: { ats_provider: provider, slug, jobs }, requests };
    }
  }
  return { hit: null, requests };
}

// ── Handler ─────────────────────────────────────────────────────────────────

interface Candidate {
  startup_id: string;
  name: string | null;
  website: string | null;
  sector_parent: string | null;
}

async function stampAttempted(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("startups")
    .update({ board_discovery_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(`stamp board_discovery_at: ${error.message}`);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    dryRun = body?.dryRun === true;
  } catch {
    /* no body — defaults */
  }

  try {
    const { data, error } = await supabase
      .from("board_discovery_candidates")
      .select("startup_id, name, website, sector_parent")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return json({ error: `select candidates: ${error.message}` }, 500);

    const candidates = (data ?? []) as Candidate[];
    if (candidates.length === 0) return json({ attempted: 0, registered: 0, note: "no candidates pending" });

    // Dry run: show the slugs without spending a single request on the ATSes.
    if (dryRun) {
      return json({
        dryRun: true,
        candidates: candidates.map((c) => ({
          name: c.name,
          website: c.website,
          sector_parent: c.sector_parent,
          slugs: slugCandidates(c.website, c.name),
        })),
      });
    }

    const results: Array<Record<string, unknown>> = [];
    const attemptedIds: string[] = [];
    let registered = 0;
    let totalRequests = 0;

    for (const c of candidates) {
      const slugs = slugCandidates(c.website, c.name);
      attemptedIds.push(c.startup_id);

      if (slugs.length === 0) {
        results.push({ name: c.name, website: c.website, found: false, reason: "no usable slug from website or name" });
        continue;
      }

      const { hit, requests } = await findBoard(slugs);
      totalRequests += requests;

      if (!hit) {
        results.push({ name: c.name, slugs, found: false, requests, reason: "no board on any provider" });
        continue;
      }

      // Register. onConflict keeps this idempotent if the same board was added
      // by hand earlier; startup_id is set so age scoring can read founded_year.
      const { error: insErr } = await supabase
        .from("sourcing_companies")
        .upsert(
          {
            ats_provider: hit.ats_provider,
            ats_board_token: hit.slug,
            inferred_name: c.name,
            startup_id: c.startup_id,
          },
          { onConflict: "ats_provider,ats_board_token" },
        );
      if (insErr) {
        results.push({ name: c.name, found: true, ...hit, registered: false, reason: insErr.message });
        continue;
      }
      registered++;
      results.push({ name: c.name, found: true, ...hit, registered: true, requests });
    }

    // Stamp every company we looked at, hit or miss — a company with no board
    // must not come back in the next batch forever.
    await stampAttempted(supabase, attemptedIds);

    return json({
      attempted: candidates.length,
      registered,
      notFound: candidates.length - registered,
      atsRequests: totalRequests,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "discovery failed" }, 500);
  }
});
