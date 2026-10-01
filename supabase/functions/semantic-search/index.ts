// =============================================================================
// Edge Function: semantic-search
// The query-time half of the AI Search & Q&A Engine (Phase 1). The browser can
// NOT embed queries itself — that would require shipping a credential to the
// client, where it would be trivially extractable. So this server-side function
// embeds the incoming query with the SAME model used for the corpus
// (nomic-ai/nomic-embed-text-v1.5, 768-d, served by our self-hosted Text
// Embeddings Inference (TEI) instance on RunPod — see
// supabase/functions/_shared/tei-client.ts), and calls the
// match_companies_and_funds RPC to retrieve the most semantically relevant
// startups/investors from OUR DB.
//
// It returns ONLY rows that exist in our database — this is the anti-hallucination
// guarantee: the downstream Q&A/answer step (Phase 2) is handed this grounding
// context and instructed to answer strictly from it.
//
// Request  (POST JSON): { query: string, matchCount?: number, matchThreshold?: number,
//                         entityFilter?: 'all' | 'startup' | 'investor' }
// Response (JSON):       { query, matches: MatchRow[], model, count }
//
// Deploy:  supabase functions deploy semantic-search
// Secrets: RUNPOD_TEI_URL (REQUIRED — e.g. https://<POD_ID>-8080.proxy.runpod.net),
//          RUNPOD_TEI_KEY (optional, only if that TEI instance has its own auth).
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically
//          by the platform.
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { embedQuery } from "../_shared/tei-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMBED_MODEL = "nomic-ai/nomic-embed-text-v1.5";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query          = typeof body.query === "string" ? body.query.trim() : "";
    const matchCount     = Math.min(Math.max(Number(body.matchCount ?? 10), 1), 50);
    const matchThreshold = Math.min(Math.max(Number(body.matchThreshold ?? 0.25), 0), 1);
    const entityFilter   = ["all", "startup", "investor"].includes(body.entityFilter)
      ? body.entityFilter : "all";

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing `query`" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const teiUrl = Deno.env.get("RUNPOD_TEI_URL");
    if (!teiUrl) throw new Error("RUNPOD_TEI_URL is not configured");
    const teiKey = Deno.env.get("RUNPOD_TEI_KEY") || undefined;

    // 1. Embed the query server-side.
    const queryEmbedding = await embedQuery(query, { baseUrl: teiUrl, apiKey: teiKey, model: EMBED_MODEL });

    // 2. Retrieve grounding context from our own database via the RPC.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabase.rpc("match_companies_and_funds", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      match_threshold: matchThreshold,
      entity_filter: entityFilter,
    });
    if (error) throw error;

    return new Response(
      JSON.stringify({ query, model: EMBED_MODEL, count: data?.length ?? 0, matches: data ?? [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("semantic-search error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
