// =============================================================================
// Edge Function: chat-analyst
//
// The multi-turn "AlphaMap AI Analyst" behind AISearchWorkspace.tsx. Replaces
// that workspace's single-shot semantic-search -> answer-query pipeline with a
// Hybrid retrieval loop: Claude picks between a fuzzy semantic_search tool
// (wrapping the same match_companies_and_funds RPC semantic-search/index.ts
// uses) and precise structured tools (filter_startups, get_funding_rounds,
// get_news, get_patents, search_investors) — chaining calls across up to
// MAX_ITERATIONS turns before writing its final answer.
//
// Anti-hallucination is still structural, not just prompted: every fact the
// model states must come from a tool_result in THIS conversation. There is no
// database access outside the six named tools below — no free-form SQL, no
// tool that isn't a narrow, parameterized query. Citations use the same
// [Name](cite:ID) convention as answer-query; every startup/investor tool
// hands back a `matches` entry so the frontend can render a card AND resolve
// the citation, even for the "detail" tools (get_funding_rounds/get_news/
// get_patents) that weren't reached via a search tool this turn.
//
// Wire protocol (this is a deliberate departure from answer-query's plain-text
// stream — a conversation with tool calls needs to carry more than token
// deltas): the response is newline-delimited JSON, one event per line:
//   {"type":"tool_start","tool":"filter_startups","label":"Searching startups…"}
//   {"type":"matches","items":[MatchRow, ...]}
//   {"type":"tool_done","tool":"filter_startups"}
//   {"type":"text","delta":"..."}
//   {"type":"done"}
//   {"type":"error","message":"..."}
//
// Request (POST JSON): { messages: {role: "user"|"assistant", content: string}[] }
//   The client sends the FULL visible conversation history each turn — no
//   server-side session state for this first version.
//
// Deploy:  supabase functions deploy chat-analyst --no-verify-jwt
// Secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY (semantic_search tool's embedding
//          step — same key semantic-search/index.ts already uses).
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are platform-injected.
// =============================================================================

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL           = Deno.env.get("CHAT_ANALYST_MODEL") ?? "claude-sonnet-5";
const MAX_TOKENS       = Number(Deno.env.get("CHAT_ANALYST_MAX_TOKENS") ?? 1500);
const MAX_ITERATIONS   = Number(Deno.env.get("CHAT_ANALYST_MAX_ITERATIONS") ?? 4);
const EMBED_MODEL       = "text-embedding-3-small";
const EMBED_DIMS         = 1536; // must match startups/investors.embedding + the backfill script

// ── Types ─────────────────────────────────────────────────────────────────────

interface MatchRow {
  entity_type: "startup" | "investor";
  id: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  similarity: number;
  metadata: Record<string, unknown>;
}

type HistoryTurn = { role: "user" | "assistant"; content: string };

const s = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// ── Tool schemas ──────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "semantic_search",
    description:
      "Fuzzy/descriptive search over company and investor names+descriptions using semantic similarity. " +
      "Use for vague questions like 'companies doing something like X' or 'investors focused on climate' — " +
      "NOT for precise filters (use filter_startups/search_investors for those; they're faster and more exact).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description to match against." },
        entity_filter: { type: "string", enum: ["all", "startup", "investor"], description: "Default 'all'." },
      },
      required: ["query"],
    },
  },
  {
    name: "filter_startups",
    description:
      "Precise structured filter over companies — sector, funding stage, headcount, funding recency, country, " +
      "growth trend. Use for exact criteria questions ('Series A fintech in the US with 50+ employees'), not " +
      "fuzzy descriptions. All parameters are optional; omit any you don't need to filter on.",
    input_schema: {
      type: "object",
      properties: {
        sector_parent: { type: "string", description: "Exact sector name, e.g. 'AI & ML', 'Fintech', 'Cybersecurity'." },
        country: { type: "string" },
        stage: {
          type: "string",
          enum: ["Pre-Seed", "Seed", "Series A", "Series B", "Series C", "Series D", "Series E+", "Growth"],
          description: "Latest funding round type.",
        },
        min_employee_count: { type: "integer" },
        max_employee_count: { type: "integer" },
        funded_within_days: { type: "integer", description: "Only companies whose latest round was announced within this many days of today." },
        growth_trend: { type: "string", enum: ["rapid growth", "moderate growth", "stable", "reduction"] },
        limit: { type: "integer", description: "Max rows to return. Default 15, hard cap 25." },
      },
    },
  },
  {
    name: "get_funding_rounds",
    description: "All funding rounds on file for one named company, oldest to newest.",
    input_schema: {
      type: "object",
      properties: { company_name: { type: "string" } },
      required: ["company_name"],
    },
  },
  {
    name: "get_news",
    description: "Recent news articles on file for one named company.",
    input_schema: {
      type: "object",
      properties: { company_name: { type: "string" } },
      required: ["company_name"],
    },
  },
  {
    name: "get_patents",
    description: "Individual patent records on file for one named company. Most companies genuinely have none — an empty result is normal, not a failure.",
    input_schema: {
      type: "object",
      properties: { company_name: { type: "string" } },
      required: ["company_name"],
    },
  },
  {
    name: "search_investors",
    description: "Precise structured filter over investors — tier, firm type, investment stage focus.",
    input_schema: {
      type: "object",
      properties: {
        tier: { type: "integer", enum: [1, 2, 3], description: "1 = top-tier institutional investor." },
        firm_type: { type: "string", enum: ["vc", "pe", "growth"] },
        stage: { type: "string", description: "A stage in the firm's stages[] list, e.g. 'Seed', 'Series A'." },
        limit: { type: "integer", description: "Max rows to return. Default 15, hard cap 25." },
      },
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  semantic_search: "Searching AlphaMap…",
  filter_startups: "Searching startups…",
  get_funding_rounds: "Looking up funding rounds…",
  get_news: "Looking up news coverage…",
  get_patents: "Looking up patents…",
  search_investors: "Searching investors…",
};

// ── Embeddings (same model/approach as semantic-search/index.ts) ──────────────

async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, dimensions: EMBED_DIMS }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

// ── Match-row builders (same shape match_companies_and_funds returns, so the
// frontend's existing SemanticMatch rendering works unchanged regardless of
// which tool produced the row) ─────────────────────────────────────────────

function startupToMatch(row: Record<string, unknown>, similarity = 1): MatchRow {
  return {
    entity_type: "startup",
    id: row.id as string,
    name: (row.name as string) ?? null,
    slug: (row.slug as string) ?? null,
    description: (row.description as string) ?? null,
    similarity,
    metadata: {
      industry: row.sector_parent ?? row.industry ?? null,
      website: row.website ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      logo_url: row.logo_url ?? null,
      growth_trend: row.growth_trend ?? null,
    },
  };
}

function investorToMatch(row: Record<string, unknown>, similarity = 1): MatchRow {
  return {
    entity_type: "investor",
    id: row.id as string,
    name: (row.name as string) ?? null,
    slug: (row.slug as string) ?? null,
    description: (row.description as string) ?? null,
    similarity,
    metadata: {
      firm_type: row.firm_type ?? null,
      headquarters: row.headquarters ?? null,
      fund_size: row.fund_size ?? null,
      website: row.website ?? null,
      thesis: row.thesis ?? null,
      tier: row.tier ?? null,
    },
  };
}

// Shared by the three "one named company" tools — also the only place a
// citable id gets attached when the model asks about a company by name
// without having found it via search_startups/semantic_search first.
async function findStartupByName(supa: SupabaseClient, name: string) {
  const { data, error } = await supa
    .from("startups")
    .select("id, name, slug, description, industry, country, city, website, logo_url, growth_trend, news, patents")
    .ilike("name", `%${name.trim()}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Tool execution — every one of these is a narrow, parameterized query.
// Nothing here accepts or builds arbitrary SQL from model output. ────────────

interface ToolOutcome { rows: unknown; matches: MatchRow[] }

async function runTool(
  name: string,
  input: Record<string, unknown>,
  supa: SupabaseClient,
  openaiKey: string | undefined,
): Promise<ToolOutcome> {
  switch (name) {
    case "semantic_search": {
      if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");
      const query = s(input.query);
      if (!query) return { rows: [], matches: [] };
      const embedding = await embedQuery(query, openaiKey);
      const entityFilter = ["all", "startup", "investor"].includes(input.entity_filter as string)
        ? input.entity_filter : "all";
      const { data, error } = await supa.rpc("match_companies_and_funds", {
        query_embedding: embedding,
        match_count: 12,
        match_threshold: 0.25,
        entity_filter: entityFilter,
      });
      if (error) throw error;
      return { rows: data ?? [], matches: (data ?? []) as MatchRow[] };
    }

    case "filter_startups": {
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 25);
      let q = supa
        .from("startups_search")
        .select("id,name,slug,description,industry,sector_parent,country,city,employee_count,latest_round_type,latest_round_date,total_raised,growth_trend,website,logo_url")
        .limit(limit);
      if (s(input.sector_parent)) q = q.eq("sector_parent", s(input.sector_parent));
      if (s(input.country)) q = q.eq("country", s(input.country));
      if (s(input.stage)) q = q.eq("latest_round_type", s(input.stage));
      if (input.min_employee_count != null) q = q.gte("employee_count", Number(input.min_employee_count));
      if (input.max_employee_count != null) q = q.lte("employee_count", Number(input.max_employee_count));
      if (s(input.growth_trend)) q = q.eq("growth_trend", s(input.growth_trend));
      if (input.funded_within_days != null) {
        const cutoff = new Date(Date.now() - Number(input.funded_within_days) * 86_400_000).toISOString().slice(0, 10);
        q = q.gte("latest_round_date", cutoff);
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      return { rows, matches: rows.map((r) => startupToMatch(r)) };
    }

    case "get_funding_rounds": {
      const companyName = s(input.company_name);
      if (!companyName) return { rows: [], matches: [] };
      const startup = await findStartupByName(supa, companyName);
      if (!startup) return { rows: { error: "No company on file matches that name." }, matches: [] };
      const { data, error } = await supa
        .from("funding_rounds")
        .select("round_type,amount_raised,valuation,announcement_date,lead_investor,investors")
        .eq("startup_id", startup.id)
        .order("announcement_date");
      if (error) throw error;
      return {
        rows: { company: { id: startup.id, name: startup.name }, funding_rounds: data ?? [] },
        matches: [startupToMatch(startup)],
      };
    }

    case "get_news": {
      const companyName = s(input.company_name);
      if (!companyName) return { rows: [], matches: [] };
      const startup = await findStartupByName(supa, companyName);
      if (!startup) return { rows: { error: "No company on file matches that name." }, matches: [] };
      return {
        rows: { company: { id: startup.id, name: startup.name }, news: startup.news ?? [] },
        matches: [startupToMatch(startup)],
      };
    }

    case "get_patents": {
      const companyName = s(input.company_name);
      if (!companyName) return { rows: [], matches: [] };
      const startup = await findStartupByName(supa, companyName);
      if (!startup) return { rows: { error: "No company on file matches that name." }, matches: [] };
      return {
        rows: { company: { id: startup.id, name: startup.name }, patents: startup.patents ?? [] },
        matches: [startupToMatch(startup)],
      };
    }

    case "search_investors": {
      const limit = Math.min(Math.max(Number(input.limit ?? 15), 1), 25);
      let q = supa
        .from("investors")
        .select("id,name,slug,description,firm_type,tier,headquarters,fund_size,thesis,stages")
        .limit(limit);
      if (input.tier != null) q = q.eq("tier", Number(input.tier));
      if (s(input.firm_type)) q = q.eq("firm_type", s(input.firm_type));
      if (s(input.stage)) q = q.contains("stages", [s(input.stage)]);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      return { rows, matches: rows.map((r) => investorToMatch(r)) };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── System prompt — same core anti-hallucination/citation rules as
// answer-query, generalized from "one CONTEXT block" to "tool results across
// this conversation" and extended for multi-turn + tool selection. ──────────

const SYSTEM_PROMPT = `You are AlphaMap's private-markets intelligence analyst — a multi-turn AI Analyst embedded in the platform. You write concise, executive-level answers for professional investors.

ABSOLUTE RULES — anti-hallucination:
- Answer ONLY using tool results returned in this conversation. Never state a specific fact about a company, investor, funding round, news item, or patent without having called a tool this conversation that returned it.
- Do NOT use any outside knowledge. Do NOT invent or assume companies, funds, people, valuations, dates, headcounts, or any figure not explicitly present in a tool result.
- If your tool calls don't return enough information to answer, say so explicitly and state what's missing. Never fill gaps with guesses. It is correct and expected to say "AlphaMap doesn't currently have this data."
- An empty result from a tool (e.g. no patents found) is a real, valid answer — report it plainly, don't treat it as a failure to work around.
- You may answer directly without calling a tool ONLY for greetings, meta questions about what you can do, or clarifying questions — never for a factual claim about a specific company/investor/deal.

TOOL SELECTION:
- Prefer filter_startups / search_investors for precise criteria (exact sector, stage, dates, numeric thresholds).
- Prefer semantic_search for fuzzy or descriptive questions ("companies doing something like X").
- Use get_funding_rounds / get_news / get_patents only once you're discussing a SPECIFIC named company in depth.
- You may call multiple tools in one turn, or chain across turns (e.g. semantic_search to find candidates, then get_funding_rounds on the best match). Don't call a tool without a clear reason from the question.

MULTI-TURN:
- The user may ask follow-ups referring to earlier turns ("what about its Series B?", "compare the second one to it"). Resolve references using the conversation history, but every fact you state must still come from a tool call — a company discussed two turns ago is not itself a source, only the tool result that described it was.

CITATIONS — required:
- The first time in your reply you name a company or investor that a tool result identified with an id, wrap it in this exact markdown token: [Name](cite:ID) — using the id from that tool result.
- Only ever cite an id that actually appeared in a tool result this conversation. Never invent or guess an id.
- Example: "[CipherGuard AI](cite:s1) is a Berlin-based threat-detection company…"

STYLE:
- Lead with a direct 1–2 sentence answer, then supporting detail.
- Be analytical and specific; group by theme where useful. Short paragraphs, no fluff.
- Plain prose (short markdown like ** for emphasis and - for lists is fine). Keep it tight.
- When your answer is grounded in a list of companies/investors (filter_startups, semantic_search,
  search_investors), don't just hand back a bare list — open with 1-2 sentences of real market context:
  what the segment/theme actually is, then call out what's notable about the leading result(s) (why
  they're a strong match, what differentiates them) before or alongside naming the rest. The UI already
  renders the full list as cards below your answer, so you don't need to enumerate every result — write
  the analysis a person can't get from the cards alone.`;

// ── Streaming agent loop ────────────────────────────────────────────────────

function ndjson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

async function runAgentTurn(
  anthropic: Anthropic,
  messages: Anthropic.MessageParam[],
  onTextDelta: (delta: string) => void,
): Promise<{ blocks: Anthropic.ContentBlockParam[]; stopReason: string | null }> {
  const stream = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
    stream: true,
  });

  // Reconstruct content blocks by index as events arrive — a streaming
  // tool-use turn delivers a block's JSON input as a series of partial_json
  // deltas, not a single value, same as its text deltas.
  const blocks: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: string }> = [];
  let stopReason: string | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const cb = event.content_block;
      blocks[event.index] = cb.type === "tool_use"
        ? { type: "tool_use", id: cb.id, name: cb.name, input: "" }
        : { type: "text", text: "" };
    } else if (event.type === "content_block_delta") {
      const b = blocks[event.index];
      if (event.delta.type === "text_delta" && b?.type === "text") {
        b.text += event.delta.text;
        onTextDelta(event.delta.text);
      } else if (event.delta.type === "input_json_delta" && b?.type === "tool_use") {
        b.input += event.delta.partial_json;
      }
    } else if (event.type === "message_delta") {
      stopReason = event.delta.stop_reason ?? stopReason;
    }
  }

  // A tool-calling turn frequently streams an empty (or whitespace-only)
  // leading text block ahead of the tool_use block — normal from the model,
  // but the Messages API REJECTS an assistant turn that's replayed back
  // with an empty text content block, which is exactly what the next
  // iteration's messages.create call does. Drop empty text blocks here so
  // the reconstructed turn is always valid to send back.
  const finalBlocks: Anthropic.ContentBlockParam[] = blocks
    .filter((b) => b.type === "tool_use" || b.text.trim().length > 0)
    .map((b) =>
      b.type === "tool_use"
        ? { type: "tool_use", id: b.id, name: b.name, input: b.input ? JSON.parse(b.input) : {} }
        : { type: "text", text: b.text },
    );
  return { blocks: finalBlocks, stopReason };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const history: HistoryTurn[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m: unknown): m is HistoryTurn =>
          !!m && typeof m === "object" && ["user", "assistant"].includes((m as HistoryTurn).role) &&
          typeof (m as HistoryTurn).content === "string")
        .slice(-20) // cap history length sent to the model
    : [];

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "`messages` must be non-empty and end with a user turn" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY"); // semantic_search tool only — degrades gracefully without it
  const anthropic = new Anthropic({ apiKey });
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(ndjson(obj)));
      try {
        const messages: Anthropic.MessageParam[] = history.map((h) => ({ role: h.role, content: h.content }));

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const { blocks, stopReason } = await runAgentTurn(anthropic, messages, (delta) => emit({ type: "text", delta }));
          messages.push({ role: "assistant", content: blocks });

          const toolUses = blocks.filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use");
          if (toolUses.length === 0 || stopReason !== "tool_use") {
            emit({ type: "done" });
            controller.close();
            return;
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const t of toolUses) {
            const label = TOOL_LABELS[t.name] ?? `Running ${t.name}…`;
            emit({ type: "tool_start", tool: t.name, label });
            try {
              const { rows, matches } = await runTool(t.name, t.input as Record<string, unknown>, supa, openaiKey);
              if (matches.length > 0) emit({ type: "matches", items: matches });
              toolResults.push({
                type: "tool_result",
                tool_use_id: t.id,
                content: JSON.stringify(rows).slice(0, 8000),
              });
            } catch (err) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: t.id,
                content: JSON.stringify({ error: (err as Error).message }),
                is_error: true,
              });
            }
            emit({ type: "tool_done", tool: t.name });
          }
          messages.push({ role: "user", content: toolResults });
        }

        // Iteration cap hit — ask once more, tools disabled, to force a
        // synthesis from whatever's already been gathered rather than
        // leaving the user with nothing.
        const stream2 = await anthropic.messages.create({
          model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages, stream: true,
        });
        for await (const event of stream2) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            emit({ type: "text", delta: event.delta.text });
          }
        }
        emit({ type: "done" });
      } catch (err) {
        console.error("chat-analyst error:", err);
        emit({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
});
