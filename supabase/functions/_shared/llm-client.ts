// =============================================================================
// _shared/llm-client.ts
//
// Thin client for our self-hosted, fine-tuned LLM (running on the GCP VM
// behind vLLM's OpenAI-compatible server) — replaces the @anthropic-ai/sdk
// client previously used directly by chat-analyst, answer-query, and
// ingest-startup.
//
// Deliberately shaped to be a near-drop-in replacement for the subset of the
// Anthropic Messages API those three functions actually use (a system
// prompt, tools with a JSON-schema input_schema, forced tool_choice,
// streaming and non-streaming calls) rather than exposing OpenAI's own
// request/response shapes directly — every translation between the two wire
// formats happens once, here, so the calling functions' tool-loop logic,
// NDJSON event emission, and response shapes to the frontend didn't need to
// change at all; only the HTTP client construction + a rename of a couple of
// local variables did.
//
// Talks to SELF_HOSTED_LLM_URL + "/v1/chat/completions" — vLLM's own
// OpenAI-compatible endpoint — authenticated with
// "Authorization: Bearer <SELF_HOSTED_LLM_KEY>". Neither value is read from
// Deno.env here: callers already have their own "is this secret configured"
// check before constructing a client (see e.g. chat-analyst's
// ANTHROPIC_API_KEY check, now SELF_HOSTED_LLM_URL/SELF_HOSTED_LLM_KEY), and
// this keeps that error-handling path unchanged.
//
// See supabase/functions/.env.example for the full list of required
// variables.
// =============================================================================

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type MessageParam =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: ContentBlock[] }
  | { role: "user"; content: ToolResultBlock[] };

export interface CreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: ToolDef[];
  tool_choice?: { type: "tool"; name: string };
  messages: MessageParam[];
  stream?: boolean;
}

export interface CreateResult {
  content: ContentBlock[];
  stop_reason: string | null;
}

// Mirrors the subset of Anthropic's streaming Messages API event shape the
// callers' tool-loop code already consumes (content_block_start/delta,
// message_delta) — OpenAI's own streaming format has no notion of discrete
// "content blocks", just a running text delta plus a separately-indexed
// tool_calls array, so this is where that gets reassembled into the same
// block-indexed shape.
export type StreamEvent =
  | { type: "content_block_start"; index: number; content_block: { type: "text" } | { type: "tool_use"; id: string; name: string } }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { type: "message_delta"; delta: { stop_reason: string | null } };

// OpenAI/vLLM finish_reason -> the Anthropic-style stop_reason strings the
// callers already branch on (e.g. chat-analyst checks `stopReason !==
// "tool_use"` to decide whether to keep looping).
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

export class SelfHostedLLM {
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
