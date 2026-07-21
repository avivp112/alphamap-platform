// =============================================================================
// Edge Function: answer-query
// Phase 2 of the AI Search & Q&A Engine — the grounded answer layer ("the
// agent"). Takes the user's question plus the already-retrieved rows from the
// semantic-search step and streams back an executive-level synthesis.
//
// Anti-hallucination is structural, not just prompted: this function is handed
// ONLY the retrieved context and is told, in the system prompt, to answer
// strictly from it and to say so plainly when the data is insufficient. It has
// no database access of its own and no browsing — it literally cannot mention a
// company or fund that wasn't retrieved.
//
// Citations: the model is instructed to wrap every reference to a provided
// entity in the markdown token `[Name](cite:ID)`, using the exact IDs supplied
// in the context. The frontend parses those tokens into clickable chips.
//
// Streaming: responds with a text/plain stream of token deltas so the UI can
// render the answer progressively (Perplexity-style).
//
// Request  (POST JSON): { query: string, matches: MatchRow[] }
//   MatchRow = { entity_type, id, name, slug, description, similarity, metadata }
// Response: text/plain stream (the answer, with [Name](cite:ID) tokens inline)
//
// Deploy:  supabase functions deploy answer-query
// Secrets: ANTHROPIC_API_KEY (+ platform-injected SUPABASE_* — unused here).
// =============================================================================

import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL      = Deno.env.get("ANSWER_MODEL") ?? "claude-sonnet-5";
const MAX_TOKENS = Number(Deno.env.get("ANSWER_MAX_TOKENS") ?? 1200);

interface MatchRow {
  entity_type: "startup" | "investor";
  id: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  similarity: number;
  metadata: Record<string, unknown>;
}

const s = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// Compose the grounding context the model is allowed to use — nothing else.
function buildContext(matches: MatchRow[]): string {
  return matches.map((m) => {
    const rel = `${Math.round((m.similarity ?? 0) * 100)}% relevance`;
    const md = m.metadata ?? {};
    if (m.entity_type === "startup") {
      const facts = [
        s(md.industry) && `Industry: ${s(md.industry)}`,
        (s(md.city) || s(md.country)) && `Location: ${[s(md.city), s(md.country)].filter(Boolean).join(", ")}`,
        s(md.growth_trend) && `Headcount trend: ${s(md.growth_trend)}`,
        s(md.website) && `Website: ${s(md.website)}`,
      ].filter(Boolean).join(" | ");
      return `[ID: ${m.id}] (Company) ${m.name}\n` +
             `Description: ${m.description ?? "—"}\n` +
             `${facts}\n${rel}`;
    }
    const ft = s(md.firm_type);
    const facts = [
      ft && `Firm type: ${ft.toUpperCase()}`,
      s(md.headquarters) && `HQ: ${s(md.headquarters)}`,
      s(md.fund_size) && `Fund size / AUM: ${s(md.fund_size)}`,
      s(md.website) && `Website: ${s(md.website)}`,
    ].filter(Boolean).join(" | ");
    return `[ID: ${m.id}] (Investor) ${m.name}\n` +
           `Description: ${m.description ?? "—"}\n` +
           `${facts}\n${rel}`;
  }).join("\n\n");
}

const SYSTEM_PROMPT = `You are AlphaMap's private-markets intelligence analyst. You write concise, executive-level answers for professional investors.

ABSOLUTE RULES — anti-hallucination:
- Answer ONLY using the CONTEXT block below. It is the complete set of companies and investors retrieved from the AlphaMap database for this question.
- Do NOT use any outside knowledge. Do NOT invent or assume companies, funds, people, valuations, dates, headcounts, or any figure that is not explicitly in the CONTEXT.
- If the CONTEXT does not contain enough information to answer the question, say so explicitly and state what is missing. Never fill gaps with guesses. It is correct and expected to say "The AlphaMap database doesn't currently have …".
- Do not restate the relevance percentages as if they were financial metrics.

CITATIONS — required:
- Every time you name a company or investor that appears in the CONTEXT, wrap it in this exact markdown token: [Name](cite:ID) — using the ID given for that entity in the CONTEXT.
- Only ever cite IDs that appear in the CONTEXT. Never cite an ID that isn't listed.
- Example: "[CipherGuard AI](cite:s1) is a Berlin-based threat-detection company…"

STYLE:
- Lead with a direct 1–2 sentence answer, then supporting detail.
- Be analytical and specific; group by theme where useful. Short paragraphs, no fluff.
- Plain prose (you may use short markdown like ** for emphasis and - for lists). Keep it tight.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query   = typeof body.query === "string" ? body.query.trim() : "";
    const matches = Array.isArray(body.matches) ? (body.matches as MatchRow[]).slice(0, 20) : [];

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing `query`" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // No retrieved context → deterministic grounded answer, no model call.
    if (matches.length === 0) {
      return new Response(
        "The AlphaMap database doesn't currently have companies or investors that match this query. Try broadening the search, or check back once more of the dataset has been enriched.",
        { headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const anthropic = new Anthropic({ apiKey });

    const userMessage =
      `QUESTION:\n${query}\n\n` +
      `CONTEXT (the only data you may use — ${matches.length} retrieved records):\n` +
      `----------------------------------------\n${buildContext(matches)}\n----------------------------------------`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const msgStream = await anthropic.messages.create({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
            stream: true,
          });
          for await (const event of msgStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } catch (err) {
          // Surface a readable error into the stream so the UI can fall back
          // gracefully rather than hanging.
          controller.enqueue(encoder.encode(`\n\n⚠️ ${(err as Error).message}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error("answer-query error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
