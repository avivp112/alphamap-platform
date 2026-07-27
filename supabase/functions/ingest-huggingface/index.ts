// =============================================================================
// Supabase Edge Function: ingest-huggingface
//
// Layer 2, the pre-registration layer. A Hugging Face model can appear months
// before a company exists — often the org is three people and a checkpoint.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          HUGGINGFACE_TOKEN (OPTIONAL — raises rate limits, not required)
//
// Deploy:  supabase functions deploy ingest-huggingface --no-verify-jwt
// Invoke:  POST {}                            -> trending models, top 100
//          POST { "kind": "space" }           -> spaces instead of models
//          POST { "sort": "downloads" }       -> trendingScore | downloads | likes | lastModified
//          POST { "maxAgeDays": 180 }         -> only projects created recently
//          POST { "dryRun": true }            -> classify, write nothing
//
// ── THE FIRST RUN PRODUCES NO VELOCITY, AND THAT IS CORRECT ─────────────────
// Hugging Face returns a LEVEL — 1,850,000 downloads — never a history. A rate
// is a difference between two measurements, so run one records a baseline and
// every velocity column is NULL. Rates appear on run two; 7-day rates a week
// in. `has_velocity` in the response says which state you are in, because the
// alternative is staring at an empty leaderboard concluding it is broken.
//
// Schedule it daily. The value compounds only with repetition.
//
// ── WHY AGE IS THE FILTER THAT MATTERS ──────────────────────────────────────
// Trending alone surfaces whatever is popular, which is mostly Meta and Qwen
// and Mistral. The pre-company signal is a project that is BOTH young and
// moving: createdAt within a few months, climbing fast, owned by nobody you
// have heard of. maxAgeDays is the knob; the owner denylist removes the rest.
//
// ── NO TOKEN REQUIRED ───────────────────────────────────────────────────────
// Public model/dataset/space listings are unauthenticated. A token only raises
// the rate limit, so this is the one Layer 2 source that runs the day it is
// deployed.
//
// ── VERIFICATION STATUS ─────────────────────────────────────────────────────
// The sandbox blocks outbound HTTPS, so the fetch path is unexercised. Pure
// logic — mapping, age and denylist filtering, tag normalisation — is tested in
// oss.test.mjs against HF's documented response shape. Run dryRun first.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const API = "https://huggingface.co/api";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 400;
const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_AGE_DAYS = 365;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type HfKind = "model" | "dataset" | "space";
const KIND_PATH: Record<HfKind, string> = { model: "models", dataset: "datasets", space: "spaces" };
const KIND_SOURCE: Record<HfKind, string> = {
  model: "huggingface_model",
  dataset: "huggingface_dataset",
  space: "huggingface_space",
};

export const HF_SORTS = new Set(["trendingScore", "downloads", "likes", "lastModified", "createdAt"]);

// ── Pure mapping ────────────────────────────────────────────────────────────

export interface HfRepo {
  externalId: string;      // "org/name"
  owner: string;
  name: string;
  url: string;
  createdAt: string | null;
  lastModified: string | null;
  likes: number | null;
  downloads: number | null;
  tags: string[];
  pipelineTag: string | null;
  isPrivateOrGated: boolean;
}

/**
 * Map one API record.
 *
 * `id` is "org/name" for org-owned repos and bare "name" for a few legacy
 * canonical models ("gpt2", "bert-base-uncased"). Those are by definition not
 * startups, so a missing owner is a signal in itself and handled rather than
 * crashed on.
 */
export function mapRepo(rec: Record<string, unknown>, kind: HfKind): HfRepo | null {
  const id = String(rec?.id ?? rec?.modelId ?? "").trim();
  if (!id) return null;
  const slash = id.indexOf("/");
  const owner = slash > 0 ? id.slice(0, slash) : String(rec?.author ?? "").trim();
  const name = slash > 0 ? id.slice(slash + 1) : id;
  const tags = Array.isArray(rec?.tags) ? (rec!.tags as unknown[]).map(String) : [];
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    externalId: id,
    owner,
    name,
    url: `https://huggingface.co/${kind === "model" ? "" : KIND_PATH[kind] + "/"}${id}`,
    createdAt: (rec?.createdAt as string) ?? null,
    lastModified: (rec?.lastModified as string) ?? null,
    likes: num(rec?.likes),
    downloads: num(rec?.downloads),
    tags,
    pipelineTag: (rec?.pipeline_tag as string) ?? null,
    isPrivateOrGated: rec?.private === true || rec?.gated === true || rec?.disabled === true,
  };
}

/** Age in days at `now`, or null when the platform gave no creation date. */
export function ageDays(createdAt: string | null, now = Date.now()): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 86_400_000;
}

/**
 * Tags worth keeping.
 *
 * HF tags are a mixture of genuine signal ("text-generation", "agent") and
 * bookkeeping ("region:us", "license:apache-2.0", "arxiv:2401.12345",
 * "autotrain_compatible"). Keeping the lot would make tag search useless, so
 * namespaced and licence tags are dropped.
 */
export function usefulTags(tags: string[]): string[] {
  const drop = /^(region:|license:|arxiv:|doi:|dataset:|base_model:|endpoints_compatible$|autotrain_compatible$|has_space$|co2_eq_emissions$)/i;
  const out: string[] = [];
  for (const t of tags) {
    const s = String(t).trim();
    if (!s || drop.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Owners that cannot be a startup, beyond the database denylist. */
export const isPersonalNamespace = (owner: string): boolean => !owner || owner.length < 2;

export function listUrl(kind: HfKind, sort: string, limit: number, skip: number): string {
  const p = new URLSearchParams({
    sort,
    direction: "-1",
    limit: String(limit),
    skip: String(skip),
    full: "true",
  });
  return `${API}/${KIND_PATH[kind]}?${p.toString()}`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);

  const token = Deno.env.get("HUGGINGFACE_TOKEN")?.trim();   // optional

  let limit = DEFAULT_LIMIT;
  let kind: HfKind = "model";
  let sort = "trendingScore";
  let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
  let dryRun = false;
  try {
    const b = await req.json();
    const n = Number(b?.limit);
    if (Number.isFinite(n) && n > 0) limit = Math.min(Math.floor(n), MAX_LIMIT);
    if (b?.kind === "space" || b?.kind === "dataset" || b?.kind === "model") kind = b.kind;
    if (typeof b?.sort === "string" && HF_SORTS.has(b.sort)) sort = b.sort;
    const a = Number(b?.maxAgeDays);
    if (Number.isFinite(a) && a > 0) maxAgeDays = a;
    dryRun = b?.dryRun === true;
  } catch { /* defaults */ }

  try {
    // The denylist lives in the database so it can be tuned without a redeploy.
    const { data: denied } = await supabase.from("oss_excluded_owners").select("owner_login");
    const denyset = new Set((denied ?? []).map((r: { owner_login: string }) => r.owner_login.toLowerCase()));

    const kept: HfRepo[] = [];
    let skip = 0;
    let scanned = 0;
    const rejected: Record<string, number> = {};
    const reject = (why: string) => { rejected[why] = (rejected[why] ?? 0) + 1; };

    while (kept.length < limit) {
      const res = await fetch(listUrl(kind, sort, PAGE_SIZE, skip), {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return json({ error: `Hugging Face returned ${res.status}`, url: listUrl(kind, sort, PAGE_SIZE, skip) }, 502);
      const records = await res.json() as Record<string, unknown>[];
      if (!Array.isArray(records) || records.length === 0) break;

      for (const rec of records) {
        scanned++;
        const r = mapRepo(rec, kind);
        if (!r) { reject("unmappable"); continue; }
        if (r.isPrivateOrGated) { reject("private_or_gated"); continue; }
        if (isPersonalNamespace(r.owner)) { reject("no_owner"); continue; }
        if (denyset.has(r.owner.toLowerCase())) { reject("excluded_owner"); continue; }
        const age = ageDays(r.createdAt);
        // Unknown age passes: HF omits createdAt on older records, and dropping
        // them would silently discard anything the API is terse about.
        if (age !== null && age > maxAgeDays) { reject("too_old"); continue; }
        kept.push(r);
        if (kept.length >= limit) break;
      }

      skip += records.length;
      if (records.length < PAGE_SIZE) break;
      await sleep(REQUEST_DELAY_MS);
    }

    if (kept.length === 0) {
      return json({ kind, sort, scanned, rejected, recorded: 0, note: "nothing matched — try a larger maxAgeDays" });
    }

    if (dryRun) {
      return json({
        kind, sort, dryRun: true, scanned, rejected, wouldRecord: kept.length,
        sample: kept.slice(0, 25).map((r) => ({
          id: r.externalId, owner: r.owner, likes: r.likes, downloads: r.downloads,
          ageDays: ageDays(r.createdAt)?.toFixed(0) ?? null, tags: usefulTags(r.tags).slice(0, 6),
        })),
      });
    }

    const results: Array<Record<string, unknown>> = [];
    let created = 0;
    let withVelocity = 0;

    for (const r of kept) {
      const { data, error } = await supabase.rpc("record_oss_observation", {
        p_source: KIND_SOURCE[kind],
        p_external_id: r.externalId,
        p_owner_login: r.owner,
        p_name: r.name,
        p_url: r.url,
        p_description: r.pipelineTag,
        p_owner_type: "organization",
        p_tags: usefulTags(r.tags),
        p_created_at_source: r.createdAt,
        p_likes: r.likes,
        p_downloads: r.downloads,
      });
      if (error) { results.push({ id: r.externalId, ok: false, reason: error.message }); continue; }
      const d = data as { created?: boolean; has_velocity?: boolean; observations?: number };
      if (d?.created) created++;
      if (d?.has_velocity) withVelocity++;
      results.push({ id: r.externalId, ok: true, ...d });
    }

    return json({
      kind, sort, scanned, rejected,
      recorded: results.filter((r) => r.ok).length,
      newProjects: created,
      // Says plainly whether this run can produce rates yet.
      withVelocity,
      note: withVelocity === 0
        ? "baseline run — every project has a single observation, so velocity is NULL. Run again tomorrow."
        : `${withVelocity} projects now have two or more observations`,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "ingest failed" }, 500);
  }
});
