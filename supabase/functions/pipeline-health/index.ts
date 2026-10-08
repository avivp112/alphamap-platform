// =============================================================================
// Supabase Edge Function: pipeline-health
//
// The daily check that the sourcing pipeline is actually alive. Scheduled by
// pg_cron at 05:30 UTC (migration 20261011000000_pipeline_monitoring.sql),
// after the night's ingesters (00:10-02:00), resolvers (03:00-03:45) and the
// embedding job (04:00). It checks:
//
//   1. every enabled source brought new rows within its window (24h daily,
//      8 days weekly; 72h for SEC / Companies House on Sunday and Monday),
//      or — for sources where an empty run is normal (job boards) — ran
//      successfully within it. Facts come from source_runs (written by each
//      function through _shared/run-log.ts) AND from the data tables
//      themselves, so a source is judged by what actually arrived;
//   2. the TEI embedding server on RunPod answers with a 768-d vector;
//   3. no company with a description has waited more than 26h for its
//      embedding, and the embedding job succeeded within 26h;
//   4. generate-live-alerts succeeded within 24h;
//   5. no SQL cron job failed in the last 24h.
//
// Every result is stored in pipeline_health_checks. Each failure becomes an
// in-app notification (bell icon) for every address in
// pipeline_alert_recipients that has an account, at most once per check per
// day, and — when RESEND_API_KEY is set — one email listing all failures.
// If this function itself stops running, the SQL job
// pipeline-health-watchdog notices the missing results and notifies too.
//
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-injected)
//          RUNPOD_TEI_URL (+ RUNPOD_TEI_KEY if the TEI server has auth)
//          RESEND_API_KEY (optional — without it, alerts are in-app only)
//          HEALTH_FROM_EMAIL (optional sender; default Resend's shared domain)
//
// Deploy:  supabase functions deploy pipeline-health --no-verify-jwt
// Invoke:  POST {}                 -> run the checks, notify on failures
//          POST { "notify": false } -> run and store, notify nobody
// Only callers holding the service-role key are served — it sends email.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateChecks, type Snapshot, type TeiProbe } from "./checks.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const DEFAULT_FROM_EMAIL = "AlphaMap Pipeline <onboarding@resend.dev>";

async function probeTei(): Promise<TeiProbe> {
  const base = Deno.env.get("RUNPOD_TEI_URL")?.trim();
  if (!base) return { ok: false, detail: "RUNPOD_TEI_URL is not set" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = Deno.env.get("RUNPOD_TEI_KEY")?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const started = Date.now();
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/embeddings`, {
      method: "POST", headers,
      body: JSON.stringify({ model: "nomic-ai/nomic-embed-text-v1.5", input: ["search_document: pipeline health check"] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${base} — ${(await res.text()).slice(0, 200)}` };
    const body = await res.json() as { data?: Array<{ embedding?: number[] }> };
    const dims = body.data?.[0]?.embedding?.length ?? 0;
    if (dims !== 768) return { ok: false, detail: `answered, but with a ${dims}-d vector (expected 768)` };
    return { ok: true, detail: `answered in ${Date.now() - started} ms` };
  } catch (e) {
    return { ok: false, detail: `no answer from ${base}: ${e instanceof Error ? e.message : String(e)} (pod stopped?)` };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req: Request): Promise<Response> => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "Supabase env not available" }, 500);
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) return json({ error: "service role only" }, 401);

  let notify = true;
  try { notify = (await req.json())?.notify !== false; } catch { /* no body */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: snap, error: snapErr } = await supabase.rpc("pipeline_health_snapshot");
  if (snapErr) return json({ error: `pipeline_health_snapshot: ${snapErr.message}` }, 500);

  const checks = evaluateChecks(snap as Snapshot, await probeTei());
  const failed = checks.filter((c) => !c.ok);

  const { data: rec, error: recErr } = await supabase.rpc("record_pipeline_health", { p_checks: checks, p_notify: notify });
  if (recErr) return json({ error: `record_pipeline_health: ${recErr.message}`, checks }, 500);
  const recorded = rec as { notified: number; recipients: string[] };

  let emailed = 0, emailError: string | null = null;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (notify && failed.length > 0 && recorded.recipients.length > 0) {
    if (!resendKey) {
      emailError = "RESEND_API_KEY is not set — in-app notification only";
    } else {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("HEALTH_FROM_EMAIL") || DEFAULT_FROM_EMAIL,
          to: recorded.recipients,
          subject: `[AlphaMap] Pipeline health: ${failed.length} problem(s)`,
          html: `<p>The daily pipeline check found ${failed.length} problem(s):</p><ul>${
            failed.map((c) => `<li><strong>${escapeHtml(c.check)}</strong> — ${escapeHtml(c.detail)}</li>`).join("")
          }</ul><p>All results: <code>SELECT * FROM pipeline_health_checks ORDER BY checked_at DESC LIMIT 30;</code> — per-source runs: <code>SELECT * FROM source_health;</code></p>`,
        }),
      });
      if (res.ok) emailed = recorded.recipients.length;
      else emailError = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
    }
  }

  return json({ ok: failed.length === 0, failed: failed.length, checks, notified: recorded.notified, emailed, emailError });
});
