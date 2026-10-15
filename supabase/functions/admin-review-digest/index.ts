// =============================================================================
// Supabase Edge Function: admin-review-digest
//
// The weekly email reminder for the company review queue (stage 5; the daily
// reminder is in the bell — notify_admins_review_queue()). Scheduled by
// pg_cron on Sundays 06:10 UTC (migration 20261018000000). Sends one email to
// every admin (app_admins) with the pending count, what to look at first, and
// the week's activity. Nothing is sent when the queue is empty.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          RESEND_API_KEY (already set for pipeline-health)
//          HEALTH_FROM_EMAIL (optional sender, shared with pipeline-health)
//          SITE_URL (optional — the email links to <SITE_URL>/admin/review
//                    only when set; it never guesses the domain)
//
// Deploy:  supabase functions deploy admin-review-digest --no-verify-jwt
// Invoke:  POST {}                   -> email the admins if anything is pending
//          POST { "testEmail": true } -> always email, marked as a test
// Only callers holding a service-role key are served — it sends email
// (_shared/service-auth.ts).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleRequest } from "../_shared/service-auth.ts";
import { buildDigest, type ReviewSummary } from "./digest.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const DEFAULT_FROM_EMAIL = "AlphaMap <onboarding@resend.dev>";

Deno.serve(async (req: Request): Promise<Response> => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  if (!(await isServiceRoleRequest(req.headers.get("Authorization"), { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY }))) {
    return json({ error: "service role only" }, 401);
  }

  let testEmail = false;
  try {
    testEmail = (await req.json())?.testEmail === true;
  } catch { /* no body */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await supabase.rpc("admin_review_summary");
  if (error) return json({ error: `admin_review_summary: ${error.message}` }, 500);
  const summary = data as ReviewSummary;

  if (summary.admin_emails.length === 0) return json({ pending: summary.pending, emailed: 0, skipped: "no admin accounts" });
  if (summary.pending === 0 && !testEmail) return json({ pending: 0, emailed: 0, skipped: "nothing pending" });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ pending: summary.pending, emailed: 0, error: "RESEND_API_KEY is not set" }, 500);

  const { subject, html } = buildDigest(summary, { now: new Date(), siteUrl: Deno.env.get("SITE_URL"), test: testEmail });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("HEALTH_FROM_EMAIL") || DEFAULT_FROM_EMAIL, to: summary.admin_emails, subject, html }),
  });
  if (!res.ok) {
    return json({ pending: summary.pending, emailed: 0, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` }, 502);
  }
  return json({ pending: summary.pending, emailed: summary.admin_emails.length, subject });
});
