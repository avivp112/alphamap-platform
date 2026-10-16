// =============================================================================
// Supabase Edge Function: company-check
//
// The one entry point of "check a company" — used by both the My Area CRM
// and the Private Market search (no logic is duplicated in the pages).
//
// POST { action: "create", input: { name, website?, country?, founder?,
//        linkedin?, sector? } }  with the user's session token:
//   1. validates and normalises the input (_shared/company-check.ts);
//   2. a company already in AlphaMap (by website domain or LinkedIn page) is
//      returned at once — status "matched", nothing is run or charged;
//   3. otherwise checks the allowance (plan from user_plans, limits in
//      _shared/check-limits.ts) and queues a private company_checks row for
//      the check worker, which runs the threshold checks (public / non-tech /
//      stealth) and, from stage 3, the enrichment.
//
// Every row is the caller's own (RLS). Nothing here is visible to other users
// or feeds anything shared.
//
// Deploy: supabase functions deploy company-check --no-verify-jwt
//         (it verifies the session itself, to answer with a clear 401).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateCheckInput, decideAllowance, monthStartUtc } from "../_shared/company-check.ts";
import { FRESH_ENOUGH_DAYS, FREE_OF_CHARGE_STATUSES } from "../_shared/check-limits.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = token ? await supabase.auth.getUser(token) : { data: { user: null }, error: null };
  const user = auth?.user;
  if (authErr || !user) return json({ error: "Sign in to check a company." }, 401);

  let body: { action?: string; input?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (body.action !== "create") return json({ error: `Unknown action: ${body.action ?? "none"}` }, 400);

  const v = validateCheckInput(body.input ?? {});
  if (!v.ok) return json({ error: "Please fix the highlighted fields.", fields: v.errors }, 422);
  const input = v.input;

  // Usage so far — this user's own rows only.
  const now = new Date();
  const [planRes, hourRes, monthRes] = await Promise.all([
    supabase.from("user_plans").select("plan").eq("user_id", user.id).maybeSingle(),
    supabase.from("company_checks").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", new Date(now.getTime() - 3_600_000).toISOString()),
    supabase.from("company_checks").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", monthStartUtc(now).toISOString())
      .not("status", "in", `(${FREE_OF_CHARGE_STATUSES.join(",")})`),
  ]);
  for (const r of [planRes, hourRes, monthRes]) if (r.error) return json({ error: r.error.message }, 500);
  const usage = { plan: planRes.data?.plan ?? "free", chargedThisMonth: monthRes.count ?? 0, requestsLastHour: hourRes.count ?? 0 };

  // Already in AlphaMap? Strong identifiers only (domain, LinkedIn company page).
  if (input.website || input.linkedin) {
    const { data: found, error } = await supabase.rpc("find_existing_startup", { p_website: input.website, p_linkedin: input.linkedin });
    if (error) return json({ error: error.message }, 500);
    const match = Array.isArray(found) ? found[0] : null;
    if (match) {
      const allow = decideAllowance(usage, false);
      if (!allow.ok) return json({ error: "Too many requests — try again in a little while.", reason: allow.reason }, 429);
      const ageDays = match.last_enriched_at ? (now.getTime() - Date.parse(match.last_enriched_at)) / 86_400_000 : Infinity;
      const { data: row, error: insErr } = await supabase.from("company_checks")
        .insert({ user_id: user.id, input, status: "matched", matched_startup_id: match.id, finished_at: now.toISOString() })
        .select("id").single();
      if (insErr) return json({ error: insErr.message }, 500);
      return json({
        status: "matched", check_id: row.id,
        startup: { id: match.id, name: match.name, website: match.website },
        fresh: ageDays <= FRESH_ENOUGH_DAYS,
      });
    }
  }

  const allow = decideAllowance(usage, true);
  if (!allow.ok) {
    return json({
      error: allow.reason === "monthly_limit"
        ? `You have used this month's ${allow.limits.checksPerMonth} check${allow.limits.checksPerMonth === 1 ? "" : "s"} on your plan.`
        : "Too many requests — try again in a little while.",
      reason: allow.reason, limit: allow.limits.checksPerMonth,
    }, 429);
  }

  const { data: row, error: insErr } = await supabase.from("company_checks")
    .insert({ user_id: user.id, input, status: "queued" })
    .select("id").single();
  if (insErr) return json({ error: insErr.message }, 500);
  return json({ status: "queued", check_id: row.id, remaining: allow.remaining - 1 });
});
