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
// Secrets: SELF_HOSTED_LLM_URL, SELF_HOSTED_LLM_KEY (our self-hosted,
//          fine-tuned LLM behind vLLM's OpenAI-compatible server — see
//          supabase/functions/.env.example). SUPABASE_* is platform-injected
//          and unused here.
// =============================================================================

// ── Self-hosted LLM client ───────────────────────────────────────────────────
// Inlined rather than imported from supabase/functions/_shared/llm-client.ts
// (the canonical, more-documented copy — keep the two in sync if this ever
// changes): this function is deployed by pasting a single file into the
// Supabase Dashboard's function editor, not via the CLI, so it can't
// reference a sibling module the way ingest-startup (CI-deployed) does.
//
// Talks to SELF_HOSTED_LLM_URL + "/v1/chat/completions" — vLLM's
// OpenAI-compatible server for our self-hosted, fine-tuned model —
// authenticated with "Authorization: Bearer <SELF_HOSTED_LLM_KEY>". Shaped
// to be a near-drop-in replacement for the subset of the Anthropic Messages
// API this function used previously (system prompt, JSON-schema tools,
// streaming), so the tool-loop / response-shape code below it didn't need
// to change — only the client construction + a rename of a couple of local
// variables did. See supabase/functions/.env.example for the full list of
// required variables.

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type MessageParam =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: ContentBlock[] }
  | { role: "user"; content: ToolResultBlock[] };

interface CreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: ToolDef[];
  tool_choice?: { type: "tool"; name: string };
  messages: MessageParam[];
  stream?: boolean;
}

interface CreateResult {
  content: ContentBlock[];
  stop_reason: string | null;
}

// Mirrors the subset of Anthropic's streaming Messages API event shape the
// tool-loop code below already consumes (content_block_start/delta,
// message_delta) — OpenAI's own streaming format has no notion of discrete
// "content blocks", just a running text delta plus a separately-indexed
// tool_calls array, so this is where that gets reassembled into the same
// block-indexed shape.
type StreamEvent =
  | { type: "content_block_start"; index: number; content_block: { type: "text" } | { type: "tool_use"; id: string; name: string } }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { type: "message_delta"; delta: { stop_reason: string | null } };

// OpenAI/vLLM finish_reason -> the Anthropic-style stop_reason strings this
// function already branches on.
function mapFinishReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case "tool_calls": return "tool_use";
    case "length": return "max_tokens";
    case "stop": return "end_turn";
    case null:
    case undefined: return null;
    default: return reason;
  }
}

function toOpenAIMessages(system: string | undefined, messages: MessageParam[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const blocks = m.content as ContentBlock[];
      const text = blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const toolCalls = blocks
        .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    // role === "user" with ToolResultBlock[] — OpenAI wants one separate
    // "tool" message per result, immediately after the assistant turn that
    // requested them, not bundled into one user turn the way Anthropic
    // does.
    for (const block of m.content as ToolResultBlock[]) {
      out.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: block.is_error ? `Error: ${block.content}` : block.content,
      });
    }
  }
  return out;
}

function toOpenAITools(tools: ToolDef[] | undefined): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toOpenAIToolChoice(toolChoice: CreateParams["tool_choice"]): unknown {
  if (!toolChoice) return undefined;
  return { type: "function", function: { name: toolChoice.name } };
}

interface OpenAIToolCall { id: string; function: { name: string; arguments: string } }
interface OpenAIChatCompletion {
  choices: Array<{
    message: { content: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason: string | null;
  }>;
}
interface OpenAIStreamToolCallDelta { index: number; id?: string; function?: { name?: string; arguments?: string } }
interface OpenAIStreamChunk {
  choices: Array<{
    delta: { content?: string; tool_calls?: OpenAIStreamToolCallDelta[] };
    finish_reason?: string | null;
  }>;
}

class SelfHostedLLM {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: { baseUrl: string; apiKey: string }) {
    // Trim a trailing slash so `${baseUrl}/v1/chat/completions` never ends
    // up with a doubled "//".
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
  }

  private async post(body: Record<string, unknown>): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Self-hosted LLM ${res.status}: ${text.slice(0, 2000)}`);
    }
    return res;
  }

  async create(params: CreateParams & { stream?: false }): Promise<CreateResult>;
  async create(params: CreateParams & { stream: true }): Promise<AsyncIterable<StreamEvent>>;
  async create(params: CreateParams): Promise<CreateResult | AsyncIterable<StreamEvent>> {
    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages: toOpenAIMessages(params.system, params.messages),
      stream: !!params.stream,
    };
    const tools = toOpenAITools(params.tools);
    if (tools) body.tools = tools;
    const toolChoice = toOpenAIToolChoice(params.tool_choice);
    if (toolChoice) body.tool_choice = toolChoice;

    if (!params.stream) {
      const res = await this.post(body);
      const json = await res.json() as OpenAIChatCompletion;
      const choice = json.choices[0];
      const content: ContentBlock[] = [];
      if (choice.message.content) content.push({ type: "text", text: choice.message.content });
      for (const tc of choice.message.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
        });
      }
      return { content, stop_reason: mapFinishReason(choice.finish_reason) };
    }

    const res = await this.post(body);
    return streamEvents(res);
  }
}

// Parses vLLM/OpenAI's SSE stream ("data: {...}\n\n", terminated by
// "data: [DONE]\n\n") into the Anthropic-style block-indexed events above.
// Block 0 is always the text block (started lazily, on first text delta, to
// mirror how a tool-only turn never gets a text block at all); each
// tool_call's own OpenAI-reported `index` is offset by +1 so it never
// collides with the text block's index 0.
async function* streamEvents(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let textBlockStarted = false;
  const toolBlockStarted = new Set<number>();

  function* handleLine(line: string): Generator<StreamEvent> {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk: OpenAIStreamChunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return; // a malformed/partial line — best-effort, same as a dropped token elsewhere
    }
    const choice = chunk.choices?.[0];
    if (!choice) return;

    if (choice.delta?.content) {
      if (!textBlockStarted) {
        textBlockStarted = true;
        yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
      }
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: choice.delta.content } };
    }

    for (const tc of choice.delta?.tool_calls ?? []) {
      const blockIndex = tc.index + 1;
      if (!toolBlockStarted.has(blockIndex)) {
        toolBlockStarted.add(blockIndex);
        yield {
          type: "content_block_start",
          index: blockIndex,
          content_block: { type: "tool_use", id: tc.id ?? "", name: tc.function?.name ?? "" },
        };
      }
      if (tc.function?.arguments) {
        yield {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: tc.function.arguments },
        };
      }
    }

    if (choice.finish_reason) {
      yield { type: "message_delta", delta: { stop_reason: mapFinishReason(choice.finish_reason) } };
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // last (possibly incomplete) line stays in the buffer
      for (const line of lines) {
        yield* handleLine(line.trim());
      }
    }
    if (buffer.trim()) yield* handleLine(buffer.trim());
  } finally {
    reader.releaseLock();
  }
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL      = Deno.env.get("ANSWER_MODEL") ?? Deno.env.get("SELF_HOSTED_LLM_MODEL") ?? "";
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

    const baseUrl = Deno.env.get("SELF_HOSTED_LLM_URL");
    const apiKey = Deno.env.get("SELF_HOSTED_LLM_KEY");
    if (!baseUrl || !apiKey) throw new Error("SELF_HOSTED_LLM_URL / SELF_HOSTED_LLM_KEY are not configured");
    const llm = new SelfHostedLLM({ baseUrl, apiKey });

    const userMessage =
      `QUESTION:\n${query}\n\n` +
      `CONTEXT (the only data you may use — ${matches.length} retrieved records):\n` +
      `----------------------------------------\n${buildContext(matches)}\n----------------------------------------`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const msgStream = await llm.create({
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
