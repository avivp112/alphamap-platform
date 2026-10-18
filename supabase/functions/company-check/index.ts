// =============================================================================
// Supabase Edge Function: company-check
//
// The one entry point of "check a company" — used by both the My Area CRM
// and the Private Market search (no logic is duplicated in the pages).
// Called with the user's session token:
//
// POST { action: "identify", input: { name, website?, country?, founder?,
//        linkedin?, sector? } }
//   1. validates and normalises the input (_shared/company-check.ts);
//   2. a company already in AlphaMap (by website domain or LinkedIn page) is
//      returned at once — status "matched", nothing is run or charged;
//   3. otherwise checks the allowance (plan from user_plans, limits in
//      _shared/check-limits.ts) and queues the IDENTIFY phase: the check
//      worker runs one short search and leaves candidates for the user
//      ("is this the company you mean?"). Not charged.
//
// POST { action: "confirm", check_id, choice: <candidate index> | "none" }
//   The user's answer. A candidate already in AlphaMap -> "matched". Otherwise
//   the allowance is checked again (it is taken now) and the check phase is
//   queued with the confirmed website: public / non-tech / stealth checks
//   and, from stage 3, the enrichment.
//
// Cancelling an unstarted check needs no function: cancel_company_check()
// is callable from the browser for the user's own rows.
//
// Every row is the caller's own (RLS). Nothing here is visible to other users
// or feeds anything shared.
//
// Deploy: supabase functions deploy company-check --no-verify-jwt
//         (it verifies the session itself, to answer with a clear 401).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateCheckInput, decideAllowance, monthStartUtc, applyChoice, type CheckInput } from "../_shared/company-check.ts";
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

  let body: { action?: string; input?: Record<string, unknown>; check_id?: unknown; choice?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

  // Usage so far — this user's own rows only. Only check-phase rows are ever charged.
  const now = new Date();
  const [planRes, hourRes, monthRes] = await Promise.all([
    supabase.from("user_plans").select("plan").eq("user_id", user.id).maybeSingle(),
    supabase.from("company_checks").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", new Date(now.getTime() - 3_600_000).toISOString()),
    supabase.from("company_checks").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("phase", "check").gte("created_at", monthStartUtc(now).toISOString())
      .not("status", "in", `(${FREE_OF_CHARGE_STATUSES.join(",")})`),
  ]);
  for (const r of [planRes, hourRes, monthRes]) if (r.error) return json({ error: r.error.message }, 500);
  const usage = { plan: planRes.data?.plan ?? "free", chargedThisMonth: monthRes.count ?? 0, requestsLastHour: hourRes.count ?? 0 };

  const refuse = (allow: Extract<ReturnType<typeof decideAllowance>, { ok: false }>) => json({
    error: allow.reason === "monthly_limit"
      ? `You have used this month's ${allow.limits.checksPerMonth} check${allow.limits.checksPerMonth === 1 ? "" : "s"} on your plan.`
      : "Too many requests — try again in a little while.",
    reason: allow.reason, limit: allow.limits.checksPerMonth,
  }, 429);

  if (body.action === "identify") {
    const v = validateCheckInput(body.input ?? {});
    if (!v.ok) return json({ error: "Please fix the highlighted fields.", fields: v.errors }, 422);
    const input = v.input;

    // Already in AlphaMap? Strong identifiers only (domain, LinkedIn company page).
    if (input.website || input.linkedin) {
      const { data: found, error } = await supabase.rpc("find_existing_startup", { p_website: input.website, p_linkedin: input.linkedin });
      if (error) return json({ error: error.message }, 500);
      const match = Array.isArray(found) ? found[0] : null;
      if (match) {
        const allow = decideAllowance(usage, false);
        if (!allow.ok) return refuse(allow);
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

    // Refuse now rather than after the user has confirmed the company.
    const allow = decideAllowance(usage, true);
    if (!allow.ok) return refuse(allow);
    const { data: row, error: insErr } = await supabase.from("company_checks")
      .insert({ user_id: user.id, input, phase: "identify", status: "queued" })
      .select("id").single();
    if (insErr) return json({ error: insErr.message }, 500);
    return json({ status: "identifying", check_id: row.id, remaining: allow.remaining });
  }

  if (body.action === "confirm") {
    const checkId = typeof body.check_id === "string" ? body.check_id : "";
    const { data: row, error } = await supabase.from("company_checks")
      .select("id, status, input, candidates").eq("id", checkId).eq("user_id", user.id).maybeSingle();
    if (error && !/invalid input syntax/i.test(error.message)) return json({ error: error.message }, 500);
    if (!row) return json({ error: "Check not found." }, 404);
    if (row.status !== "awaiting_confirmation") return json({ error: "This check has already moved on.", status: row.status }, 409);

    const choice = applyChoice(row.input as CheckInput, row.candidates, body.choice);
    if (!choice.ok) return json({ error: choice.error }, 422);

    if (!choice.startupId) {
      const allow = decideAllowance(usage, true);
      if (!allow.ok) return refuse(allow);
    }
    const { data: done, error: cErr } = await supabase.rpc("confirm_company_check", {
      p_id: row.id, p_user: user.id, p_identity: choice.identity, p_input: choice.input, p_startup_id: choice.startupId,
    });
    if (cErr) return json({ error: cErr.message }, 500);
    if (done !== true) return json({ error: "This check has already moved on." }, 409);
    return choice.startupId
      ? json({ status: "matched", check_id: row.id, startup: { id: choice.startupId, name: choice.identity.startup_name ?? choice.identity.name ?? null } })
      : json({ status: "queued", check_id: row.id });
  }

  return json({ error: `Unknown action: ${body.action ?? "none"}` }, 400);
});
