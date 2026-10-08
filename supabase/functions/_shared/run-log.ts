// =============================================================================
// _shared/run-log.ts
//
// withRunLog() wraps a source's Deno.serve handler so that EVERY invocation —
// from pg_cron or by hand — leaves a row in source_runs (migration
// 20261011000000_pipeline_monitoring.sql): when it ran, its status, how many
// rows came in, and the error in plain words.
//
// Why this exists: pg_cron reaches these functions through net.http_post,
// which only queues the request. cron.job_run_details says "succeeded" as
// soon as the request is queued, so a missing API key, a 403 from the
// upstream API or a function that was never deployed all looked like a
// healthy run. The response itself is the only place the truth is, and
// pg_net keeps it for a few hours at most.
//
// Logging never changes what the function returns, and a logging failure
// never fails the run: it is reported to the function's own log only.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyRun, type RowCounter } from "./run-classify.ts";

export { countKeys } from "./run-classify.ts";

function client(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? createClient(url, key) : null;
}

export function withRunLog(
  source: string,
  countRows: RowCounter,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return handler(req);

    const supabase = client();
    let runId: string | null = null;
    if (supabase) {
      const { data, error } = await supabase.from("source_runs").insert({ source, status: "running" }).select("id").single();
      if (error) console.error(`[run-log] ${source}: could not open a run row: ${error.message}`);
      else runId = (data as { id: string }).id;
    }

    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      res = new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    if (supabase && runId) {
      let body: unknown;
      try { body = await res.clone().json(); } catch { body = await res.clone().text().catch(() => ""); }
      const outcome = classifyRun(res.status, body, countRows);
      const { error } = await supabase.from("source_runs").update({
        finished_at: new Date().toISOString(),
        status: outcome.status,
        rows_in: outcome.rows_in,
        error: outcome.error,
        http_status: outcome.http_status,
        detail: outcome.detail,
      }).eq("id", runId);
      if (error) console.error(`[run-log] ${source}: could not close run ${runId}: ${error.message}`);
      if (outcome.status === "error") console.error(`[run-log] ${source} FAILED: ${outcome.error}`);
    }
    return res;
  };
}
