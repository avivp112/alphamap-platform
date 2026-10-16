// =============================================================================
// Edge Function: ingest-startup — RETIRED 2026-10-16
//
// It researched a company with a one-shot LLM call and wrote the result
// straight into the shared startups table — no quality gate, no privacy, and
// callable by anyone holding the public anon key. The on-demand "check a
// company" flow replaces it (company_checks + the company-check function +
// the check worker), which keeps a user's checks private and never writes
// to the shared database before verification.
//
// Kept deployed as a stub (rather than deleted) so the CI deploy list
// overwrites the old code wherever it is still live.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: "ingest-startup is retired. Use the Check company flow." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
