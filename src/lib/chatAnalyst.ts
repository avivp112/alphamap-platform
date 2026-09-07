import { supabase } from "./supabase";
import type { SemanticMatch } from "./semanticSearch";

// ─────────────────────────────────────────────────────────────────────────────
// chatAnalyst — client half of the multi-turn "AlphaMap AI Analyst" behind
// AISearchWorkspace.tsx. Calls the `chat-analyst` Edge Function, which runs a
// Hybrid retrieval loop (pgvector semantic search + structured filter tools)
// and streams back a sequence of events over a newline-delimited JSON body —
// NOT plain-text deltas like the older answer-query function, since a
// conversation with tool calls needs to carry more than token text (which
// tool is running, which entities were just retrieved).
//
// Same raw-fetch-plus-reader approach as answerQuery.ts and for the same
// reason: supabase.functions.invoke buffers the whole response, so it can't
// surface a stream.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export type ChatEvent =
  | { type: "tool_start"; tool: string; label: string }
  | { type: "tool_done"; tool: string }
  | { type: "matches"; items: SemanticMatch[] }
  | { type: "text"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface StreamChatAnalystOptions {
  onEvent: (event: ChatEvent) => void;
  signal?: AbortSignal;
}

/**
 * Streams the AI Analyst's reply to the latest turn in `history` (which must
 * end with a user turn). Resolves once the stream ends (on a "done" or
 * "error" event, or the connection closing). Throws on transport failure or a
 * non-OK response — the caller shows a graceful fallback, same as
 * streamGroundedAnswer.
 */
export async function streamChatAnalyst(
  history: ChatHistoryTurn[],
  { onEvent, signal }: StreamChatAnalystOptions,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-analyst`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify({ messages: history }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`chat-analyst ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as ChatEvent);
      } catch {
        // A malformed line shouldn't take down the whole stream — skip it.
      }
    }
  }

  // Flush any trailing line the server sent without a final newline.
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer) as ChatEvent);
    } catch {
      // ignore
    }
  }
}

// Re-exported so callers only need one import for both the streaming call
// and the citation-token parser (identical convention to answerQuery.ts).
export { parseAnswerSegments, type AnswerSegment } from "./answerQuery";
