// =============================================================================
// Edge Function: semantic-search
// The query-time half of the AI Search & Q&A Engine (Phase 1). The browser can
// NOT embed queries itself — that would require shipping the OpenAI key to the
// client, where it would be trivially extractable. So this server-side function
// holds the key, embeds the incoming query with the SAME model used for the
// corpus (text-embedding-3-small, 1536-d), and calls the match_companies_and_funds
// RPC to retrieve the most semantically relevant startups/investors from OUR DB.
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
// Secrets: OPENAI_API_KEY (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected
//          automatically by the platform).
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS  = 1536; // must match the vector(1536) column + backfill script

async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, dimensions: EMBED_DIMS }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

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

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");

    // 1. Embed the query server-side (key never leaves the server).
    const queryEmbedding = await embedQuery(query, openaiKey);

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
