// =============================================================================
// Supabase Edge Function: sourcing-crawl
//
// Crawls public ATS job boards for the FOMO & Sourcing Engine, keeping
// early_job_postings in sync with what each board is actually advertising.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected).
// Deploy:  supabase functions deploy sourcing-crawl --no-verify-jwt
// Invoke:  POST { "limit": 25 }   -> crawls the 25 stalest boards
//          POST { "board": { "ats_provider": "ashby", "ats_board_token": "x" } }
//                                 -> crawl one board on demand
//
// ── Endpoints ───────────────────────────────────────────────────────────────
//   Greenhouse  https://boards-api.greenhouse.io/v1/boards/{token}/jobs
//               -> { jobs: [ { id, title, absolute_url }, ... ] }
//               https://boards-api.greenhouse.io/v1/boards/{token}
//               -> { name }   (separate call, used once for inferred_name)
//   Lever       https://api.lever.co/v0/postings/{token}?mode=json
//               -> [ { id, text, hostedUrl }, ... ]
//   Ashby       https://api.ashbyhq.com/posting-api/job-board/{token}
//               -> { jobs: [ { id, title, jobUrl, isListed }, ... ] }
//   Workable    https://apply.workable.com/api/v1/widget/accounts/{token}?details=true
//               -> { name, jobs: [ { id, shortcode, title, url }, ... ] }
// All public, keyless, JSON, and intended for exactly this use — far more
// stable than scraping the rendered board HTML.
//
// Providers live in the PROVIDERS registry below: URL chain, parser, and
// optional same-payload name extraction per provider. Adding a fifth is a
// data change there, not new branching through the crawl path.
//
// ── Lifecycle rules (the part that has to be right) ─────────────────────────
//  * A job present in the payload is upserted on (company_id, external_job_id).
//  * A job we hold as ACTIVE but which is ABSENT from a SUCCESSFUL payload is
//    closed: is_active=false, closed_at=now(). That gap is the time-to-fill
//    signal.
//  * A job that reappears after being closed is REOPENED, preserving the
//    original first_seen_at. Ground truth is "it is live right now", and a
//    board glitch must not leave us advertising a role as filled. The trade is
//    that the earlier close/reopen episode is not retained — see NOTE below.
//  * If the fetch FAILS (network error, non-200, unparseable body) we close
//    NOTHING. Treating a transient 500 as "every role got filled" would
//    silently destroy the dataset. last_crawled_at is still stamped so a
//    permanently broken board cannot hot-loop the scheduler.
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

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const FETCH_TIMEOUT_MS = 15_000;

// ── Types ───────────────────────────────────────────────────────────────────

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workable";

export const ATS_PROVIDERS: AtsProvider[] = ["greenhouse", "lever", "ashby", "workable"];

export interface BoardRef {
  id?: string;
  ats_provider: AtsProvider;
  ats_board_token: string;
  inferred_name?: string | null;
}

/** A job as we care about it, normalised across providers. */
export interface NormalisedJob {
  external_job_id: string;
  title: string;
  url: string;
}

// ── Pure parsing (unit-testable, no network) ────────────────────────────────

const str = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && isFinite(v)) return String(v);
  return null;
};

/**
 * Greenhouse: { jobs: [ { id, title, absolute_url } ] }
 * `id` is numeric in the payload — coerced to string because external_job_id
 * is varchar (Lever uses UUIDs, so the column cannot be numeric).
 */
export function parseGreenhouse(payload: unknown): NormalisedJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: NormalisedJob[] = [];
  for (const j of jobs) {
    const o = j as Record<string, unknown>;
    const id = str(o?.id);
    const title = str(o?.title);
    const url = str(o?.absolute_url);
    // A job with no id cannot be tracked idempotently; skip rather than invent
    // a surrogate that would duplicate on the next crawl.
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url });
  }
  return out;
}

/**
 * Lever: a bare array of postings, title under `text`, link under `hostedUrl`
 * (falling back to `applyUrl`, which some older boards return instead).
 */
export function parseLever(payload: unknown): NormalisedJob[] {
  if (!Array.isArray(payload)) return [];
  const out: NormalisedJob[] = [];
  for (const p of payload) {
    const o = p as Record<string, unknown>;
    const id = str(o?.id);
    const title = str(o?.text);
    const url = str(o?.hostedUrl) ?? str(o?.applyUrl);
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url });
  }
  return out;
}

/**
 * Ashby: { jobs: [ { id, title, jobUrl, applyUrl, isListed } ] }
 *
 * isListed is respected when present: Ashby uses it to mark a posting that
 * exists but is not shown on the public board. Treating an unlisted posting as
 * live would report roles the company is not actually advertising. Absent
 * field = listed, since older payloads omit it entirely.
 */
export function parseAshby(payload: unknown): NormalisedJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: NormalisedJob[] = [];
  for (const j of jobs) {
    const o = j as Record<string, unknown>;
    if (o?.isListed === false) continue;
    const id = str(o?.id);
    const title = str(o?.title);
    const url = str(o?.jobUrl) ?? str(o?.applyUrl);
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url });
  }
  return out;
}

/**
 * Workable: { name, jobs: [ { id, shortcode, title, url, application_url } ] }
 *
 * Identity prefers `shortcode` over `id`: the shortcode is the stable public
 * handle that appears in the posting URL, while `id` has been observed to be
 * an internal numeric that is not guaranteed stable across payload versions.
 * Getting this wrong would break idempotency and duplicate every posting on
 * the next crawl, so the more durable key wins.
 *
 * Some payloads omit `url` and give only a shortcode, so the canonical link is
 * reconstructed from the board token when needed.
 */
export function parseWorkable(payload: unknown, token = ""): NormalisedJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: NormalisedJob[] = [];
  for (const j of jobs) {
    const o = j as Record<string, unknown>;
    const shortcode = str(o?.shortcode);
    const id = shortcode ?? str(o?.id);
    const title = str(o?.title);
    const url =
      str(o?.url) ??
      str(o?.application_url) ??
      (shortcode && token ? `https://apply.workable.com/${token}/j/${shortcode}/` : null);
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url });
  }
  return out;
}

// ── Provider registry ───────────────────────────────────────────────────────
// One entry per ATS. `urls` is a fallback chain tried in order until one
// yields jobs; `parse` normalises that provider's payload; `nameFrom` pulls
// the company name out of the SAME payload where the provider exposes it, so
// no extra request is needed (Greenhouse is the exception and is handled with
// a dedicated call, since its name lives on a different endpoint).
export const PROVIDERS: Record<AtsProvider, {
  urls: (token: string) => string[];
  parse: (payload: unknown, token: string) => NormalisedJob[];
  nameFrom?: (payload: unknown) => string | null;
}> = {
  greenhouse: {
    urls: (t) => [`https://boards-api.greenhouse.io/v1/boards/${t}/jobs`],
    parse: (p) => parseGreenhouse(p),
  },
  lever: {
    urls: (t) => [`https://api.lever.co/v0/postings/${t}?mode=json`],
    parse: (p) => parseLever(p),
  },
  ashby: {
    urls: (t) => [
      `https://api.ashbyhq.com/posting-api/job-board/${t}`,
      `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=false`,
    ],
    parse: (p) => parseAshby(p),
  },
  workable: {
    urls: (t) => [
      `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`,
      `https://apply.workable.com/api/v1/widget/accounts/${t}`,
    ],
    parse: (p, t) => parseWorkable(p, t),
    // Workable returns the display name alongside the jobs — free enrichment.
    nameFrom: (p) => str((p as Record<string, unknown>)?.name),
  },
};

export function parseJobs(provider: AtsProvider, payload: unknown, token = ""): NormalisedJob[] {
  const cfg = PROVIDERS[provider];
  return cfg ? cfg.parse(payload, token) : [];
}

/**
 * Given what the board is advertising and what we already hold, decide what to
 * close. Pure so the lifecycle rule can be tested without a database.
 *
 * Returns the ids of rows we hold as active that the board no longer lists.
 * De-duplicates the incoming ids first: a board that lists the same id twice
 * must not cause a row to be both upserted and closed in the same pass.
 */
export function idsToClose(
  fetched: NormalisedJob[],
  heldActive: { external_job_id: string }[],
): string[] {
  const live = new Set(fetched.map((j) => j.external_job_id));
  return heldActive.map((r) => r.external_job_id).filter((id) => !live.has(id));
}

// ── Fetching ────────────────────────────────────────────────────────────────

function boardUrls(b: BoardRef): string[] {
  const cfg = PROVIDERS[b.ats_provider];
  if (!cfg) return [];
  return cfg.urls(encodeURIComponent(b.ats_board_token));
}

async function getJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "AlphaMap-Sourcing/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, reason: `non-JSON body: ${text.slice(0, 120)}` };
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "fetch threw" };
  }
}

/** Greenhouse exposes the company's display name; Lever has no equivalent. */
async function fetchGreenhouseName(token: string): Promise<string | null> {
  const r = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`);
  if (!r.ok) return null;
  return str((r.data as Record<string, unknown>)?.name);
}

// ── Per-board crawl ─────────────────────────────────────────────────────────

export interface BoardResult {
  board: string;
  ok: boolean;
  fetched: number;
  upserted: number;
  closed: number;
  reopened: number;
  named?: string;
  reason?: string;
}

async function crawlBoard(supabase: SupabaseClient, company: BoardRef & { id: string }): Promise<BoardResult> {
  const label = `${company.ats_provider}/${company.ats_board_token}`;
  const urls = boardUrls(company);
  if (urls.length === 0) {
    return { board: label, ok: false, fetched: 0, upserted: 0, closed: 0, reopened: 0,
             reason: `unknown ats_provider "${company.ats_provider}"` };
  }

  // Walk the provider's URL chain, stopping at the first that returns jobs.
  // A 200 carrying an empty board is a legitimate answer, so only a genuinely
  // failed fetch moves on to the next candidate.
  let payload: unknown = null;
  let fetched: NormalisedJob[] = [];
  let lastReason = "";
  let gotOk = false;
  for (const url of urls) {
    const r = await getJson(url);
    if (!r.ok) { lastReason = r.reason; continue; }
    gotOk = true;
    payload = r.data;
    fetched = parseJobs(company.ats_provider, r.data, company.ats_board_token);
    if (fetched.length > 0) break;
  }

  // Hard rule: a failed fetch closes nothing. Stamp last_crawled_at anyway so
  // a dead board rotates to the back of the queue instead of being retried on
  // every single invocation.
  if (!gotOk) {
    await supabase.from("sourcing_companies")
      .update({ last_crawled_at: new Date().toISOString() })
      .eq("id", company.id);
    console.error(`[sourcing-crawl] ${label}: fetch failed — ${lastReason}`);
    return { board: label, ok: false, fetched: 0, upserted: 0, closed: 0, reopened: 0, reason: lastReason };
  }

  // What we currently hold as open, needed to compute the closures.
  const { data: heldActive, error: heldErr } = await supabase
    .from("early_job_postings")
    .select("external_job_id")
    .eq("company_id", company.id)
    .eq("is_active", true);
  if (heldErr) throw new Error(`read active postings for ${label}: ${heldErr.message}`);

  // 1. Upsert everything the board is advertising.
  //    is_active/closed_at are written explicitly so a previously closed job
  //    that reappears is reopened; first_seen_at is intentionally omitted from
  //    the update so the original discovery timestamp survives.
  let upserted = 0;
  let reopened = 0;
  if (fetched.length > 0) {
    const heldActiveSet = new Set((heldActive ?? []).map((r) => r.external_job_id));
    reopened = fetched.filter((j) => !heldActiveSet.has(j.external_job_id)).length;

    const rows = fetched.map((j) => ({
      company_id: company.id,
      external_job_id: j.external_job_id,
      title: j.title,
      url: j.url,
      is_active: true,
      closed_at: null,
    }));
    const { error } = await supabase
      .from("early_job_postings")
      .upsert(rows, { onConflict: "company_id,external_job_id" });
    if (error) throw new Error(`upsert postings for ${label}: ${error.message}`);
    upserted = rows.length;
  }

  // 2. Close what the board dropped.
  const closing = idsToClose(fetched, heldActive ?? []);
  if (closing.length > 0) {
    const { error } = await supabase
      .from("early_job_postings")
      .update({ is_active: false, closed_at: new Date().toISOString() })
      .eq("company_id", company.id)
      .eq("is_active", true)
      .in("external_job_id", closing);
    if (error) throw new Error(`close postings for ${label}: ${error.message}`);
  }

  // 3. Fill inferred_name once, if we can and it is still blank.
  let named: string | undefined;
  if (!company.inferred_name) {
    // Prefer a name already present in the payload we just fetched (Workable);
    // fall back to Greenhouse's separate board endpoint. Providers exposing
    // neither simply stay NULL until another enrichment pass fills them.
    const cfg = PROVIDERS[company.ats_provider];
    const name =
      (cfg?.nameFrom ? cfg.nameFrom(payload) : null) ??
      (company.ats_provider === "greenhouse" ? await fetchGreenhouseName(company.ats_board_token) : null);
    if (name) {
      await supabase.from("sourcing_companies").update({ inferred_name: name }).eq("id", company.id);
      named = name;
    }
  }

  // 4. Mark the pass complete.
  const { error: stampErr } = await supabase
    .from("sourcing_companies")
    .update({ last_crawled_at: new Date().toISOString() })
    .eq("id", company.id);
  if (stampErr) throw new Error(`stamp last_crawled_at for ${label}: ${stampErr.message}`);

  return {
    board: label,
    ok: true,
    fetched: fetched.length,
    upserted,
    closed: closing.length,
    // "reopened" counts jobs we did not already hold as active — i.e. brand
    // new postings plus genuine reopens. Both are "newly live to us".
    reopened,
    named,
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let limit = DEFAULT_LIMIT;
  let board: BoardRef | null = null;
  // Held separately from the parse: a malformed/absent body legitimately means
  // "crawl the default batch", but an explicitly BAD provider must surface as
  // an error rather than being swallowed by that same catch and silently
  // turning into a full batch crawl the caller never asked for.
  let badProvider: string | null = null;
  try {
    const body = await req.json();
    const n = Number(body?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    if (body?.board?.ats_provider && body?.board?.ats_board_token) {
      if (ATS_PROVIDERS.includes(body.board.ats_provider)) {
        board = body.board as BoardRef;
      } else {
        badProvider = String(body.board.ats_provider);
      }
    }
  } catch {
    /* no body — crawl the default batch */
  }

  if (badProvider) {
    return json(
      { error: `unsupported ats_provider "${badProvider}" (expected one of ${ATS_PROVIDERS.join(", ")})` },
      400,
    );
  }

  try {
    let companies: (BoardRef & { id: string })[] = [];

    if (board) {
      // On-demand: make sure the board exists, then crawl just that one.
      const { data, error } = await supabase
        .from("sourcing_companies")
        .upsert(
          { ats_provider: board.ats_provider, ats_board_token: board.ats_board_token },
          { onConflict: "ats_provider,ats_board_token", ignoreDuplicates: false },
        )
        .select("id, ats_provider, ats_board_token, inferred_name")
        .limit(1);
      if (error) return json({ error: `register board: ${error.message}` }, 500);
      companies = (data ?? []) as typeof companies;
    } else {
      // Scheduled: stalest first, never-crawled ahead of everything.
      const { data, error } = await supabase
        .from("sourcing_companies")
        .select("id, ats_provider, ats_board_token, inferred_name")
        .order("last_crawled_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) return json({ error: `select crawl queue: ${error.message}` }, 500);
      companies = (data ?? []) as typeof companies;
    }

    if (companies.length === 0) return json({ crawled: 0, results: [], note: "no boards to crawl" });

    // Sequential on purpose: these are third-party public endpoints and a
    // burst of parallel requests is the fastest way to get rate-limited off
    // them. Throughput comes from invoking more often, not harder.
    const results: BoardResult[] = [];
    for (const c of companies) {
      try {
        results.push(await crawlBoard(supabase, c));
      } catch (e) {
        // One bad board must not abort the batch.
        const label = `${c.ats_provider}/${c.ats_board_token}`;
        const reason = e instanceof Error ? e.message : "crawl threw";
        console.error(`[sourcing-crawl] ${label}: ${reason}`);
        results.push({ board: label, ok: false, fetched: 0, upserted: 0, closed: 0, reopened: 0, reason });
      }
    }

    const totals = results.reduce(
      (a, r) => ({
        fetched: a.fetched + r.fetched,
        upserted: a.upserted + r.upserted,
        closed: a.closed + r.closed,
        failed: a.failed + (r.ok ? 0 : 1),
      }),
      { fetched: 0, upserted: 0, closed: 0, failed: 0 },
    );

    return json({ crawled: results.length, ...totals, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "crawl failed" }, 500);
  }
});
