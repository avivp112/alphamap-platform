// =============================================================================
// Supabase Edge Function: snapshot-huggingface   (weekly)
//
// ingest-huggingface records only the top trending models, so most models have
// no measurement 6–10 days back and therefore no weekly growth. This job takes a
// full snapshot per ORGANIZATION: its profile (website, followers, type) and
// every one of its models' downloads and likes, appended to oss_project_metrics.
//
// The orgs come from the database (hf_orgs_to_snapshot: never listed or listed
// longest ago first, `batch` per run). Orgs we have never seen are found from the
// newest models (`discover`), so a young org's first model is in the data.
//
// HF's `downloads` is a rolling 30-day figure, not a lifetime total: a weekly
// difference is the change in that window, which is the growth signal we want.
//
// Invoke:  POST {}                          -> next 50 orgs
//          POST { "batch": 100 }            -> more per run
//          POST { "discover": 300 }         -> also read the 300 newest models (finds new orgs)
//          POST { "dryRun": true }          -> fetch and count, write nothing
//
// Schedule: NOT scheduled by this repo. After a dry run looks right, schedule it
// weekly (repeat a few times on that day to cover all orgs).
//
// The org profile endpoint's field names are mapped tolerantly (logic.ts) and
// unverified from the sandbox (outbound HTTPS blocked): run dryRun first and
// check `withWebsite` in the response.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withRunLog, countKeys } from "../_shared/run-log.ts";
import { mapOrgProfile, orgModelsUrl, orgOverviewUrl, newestModelsUrl, MODELS_PAGE } from "./logic.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 300;
const MAX_MODELS_PER_ORG = 1000;

async function getJson(url: string, token?: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, body };
}

async function record(supabase: SupabaseClient, rec: Record<string, unknown>): Promise<boolean> {
  const id = String(rec?.id ?? rec?.modelId ?? "").trim();
  const slash = id.indexOf("/");
  if (slash <= 0) return false;   // a canonical model with no org
  if (rec?.private === true || rec?.gated === true || rec?.disabled === true) return false;
  const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const tags = Array.isArray(rec?.tags) ? (rec.tags as unknown[]).map(String).filter((t) => !/^(region:|license:|arxiv:|doi:|dataset:|base_model:)/i.test(t)) : [];
  const { error } = await supabase.rpc("record_oss_observation", {
    p_source: "huggingface_model",
    p_external_id: id,
    p_owner_login: id.slice(0, slash),
    p_name: id.slice(slash + 1),
    p_url: `https://huggingface.co/${id}`,
    p_description: (rec?.pipeline_tag as string) ?? null,
    p_owner_type: "organization",
    p_tags: tags,
    p_created_at_source: (rec?.createdAt as string) ?? null,
    p_likes: num(rec?.likes),
    p_downloads: num(rec?.downloads),
  });
  return !error;
}

Deno.serve(withRunLog("huggingface_snapshot", countKeys("modelsRecorded"), async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const URL_ = Deno.env.get("SUPABASE_URL");
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!URL_ || !KEY) return json({ error: "Supabase env not available" }, 500);
  const supabase = createClient(URL_, KEY);
  const token = Deno.env.get("HUGGINGFACE_TOKEN")?.trim();

  let batch = 50, discover = 0, dryRun = false;
  try {
    const b = await req.json();
    if (Number(b?.batch) > 0) batch = Math.min(Math.floor(Number(b.batch)), 300);
    if (Number(b?.discover) > 0) discover = Math.min(Math.floor(Number(b.discover)), 2000);
    dryRun = b?.dryRun === true;
  } catch { /* defaults */ }

  const out = { orgs: 0, profiles: 0, withWebsite: 0, modelsRecorded: 0, discoveredModels: 0, failures: [] as string[] };
  try {
    // 1. Find orgs we have not seen, from the newest models.
    for (let skip = 0; skip < discover; skip += MODELS_PAGE) {
      const r = await getJson(newestModelsUrl(skip), token);
      if (!r.ok || !Array.isArray(r.body) || r.body.length === 0) { if (!r.ok) out.failures.push(`newest ${r.status}`); break; }
      for (const rec of r.body as Record<string, unknown>[]) {
        if (!dryRun && await record(supabase, rec)) out.discoveredModels++;
        else if (dryRun) out.discoveredModels++;
      }
      await sleep(DELAY_MS);
    }

    // 2. The next orgs: profile and every model.
    const { data: orgs, error } = await supabase.rpc("hf_orgs_to_snapshot", { p_limit: batch });
    if (error) return json({ error: error.message }, 500);
    for (const { org } of (orgs ?? []) as { org: string }[]) {
      out.orgs++;
      const prof = await getJson(orgOverviewUrl(org), token);
      const profile = prof.ok ? mapOrgProfile(org, prof.body as Record<string, unknown>) : null;
      if (!prof.ok) out.failures.push(`${org} profile ${prof.status}`);
      if (profile) { out.profiles++; if (profile.website) out.withWebsite++; }

      let listedAll = true;
      for (let skip = 0; skip < MAX_MODELS_PER_ORG; skip += MODELS_PAGE) {
        const r = await getJson(orgModelsUrl(org, skip), token);
        if (!r.ok || !Array.isArray(r.body)) { listedAll = false; out.failures.push(`${org} models ${r.status}`); break; }
        for (const rec of r.body as Record<string, unknown>[]) {
          if (dryRun) out.modelsRecorded++;
          else if (await record(supabase, rec)) out.modelsRecorded++;
        }
        if (r.body.length < MODELS_PAGE) break;
        await sleep(DELAY_MS);
      }
      if (!dryRun && (profile || listedAll)) {
        await supabase.rpc("record_hf_org_profile", {
          p_org: org, p_fullname: profile?.fullname ?? null, p_org_type: profile?.orgType ?? null, p_website: profile?.website ?? null,
          p_github: profile?.github ?? null, p_followers: profile?.followers ?? null, p_is_enterprise: profile?.isEnterprise ?? null,
          p_models_count: profile?.modelsCount ?? null, p_models_listed: listedAll,
        });
      }
      await sleep(DELAY_MS);
    }
    return json({ dryRun, ...out, note: "downloads is HF's rolling 30-day figure; weekly growth appears one week after the first snapshot" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "snapshot failed", ...out }, 500);
  }
}));
