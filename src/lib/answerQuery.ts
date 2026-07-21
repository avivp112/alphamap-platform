import { supabase } from "./supabase";
import type { SemanticMatch } from "./semanticSearch";

// ─────────────────────────────────────────────────────────────────────────────
// streamGroundedAnswer — client half of the Phase 2 answer layer. Calls the
// `answer-query` Edge Function and streams its text/plain token deltas back via
// an onDelta callback so the UI can render the synthesized answer progressively.
//
// We use raw fetch (not supabase.functions.invoke) specifically because invoke
// buffers the whole response — it can't surface a stream. The function endpoint
// and anon key are public config (same values already shipped in the client),
// so building the request by hand here is safe.
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface StreamAnswerOptions {
  onDelta?: (chunk: string, full: string) => void;
  signal?: AbortSignal;
}

/**
 * Streams a grounded answer for `query` over the given retrieved `matches`.
 * Resolves with the full answer text once the stream ends. Throws on transport
 * failure or a non-OK response (the caller shows a graceful fallback).
 */
export async function streamGroundedAnswer(
  query: string,
  matches: SemanticMatch[],
  opts: StreamAnswerOptions = {}
): Promise<string> {
  // Prefer the logged-in user's token; fall back to the anon key so the
  // function is reachable pre-auth too.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? ANON_KEY;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/answer-query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify({ query, matches }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`answer-query ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) {
      full += chunk;
      opts.onDelta?.(chunk, full);
    }
  }
  return full;
}

// ── Citation parsing ──────────────────────────────────────────────────────────
// The model emits references as the markdown token `[Label](cite:ID)`. This
// splits an answer string into an ordered list of plain-text and citation
// segments the renderer can turn into text + clickable chips. Incomplete
// tokens at the tail of a still-streaming string are left as plain text until
// they finish arriving.

export type AnswerSegment =
  | { kind: "text"; value: string }
  | { kind: "cite"; label: string; id: string };

const CITE_RE = /\[([^\]]+)\]\(cite:([^)\s]+)\)/g;

export function parseAnswerSegments(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITE_RE.lastIndex = 0;
  while ((match = CITE_RE.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: answer.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "cite", label: match[1], id: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < answer.length) {
    segments.push({ kind: "text", value: answer.slice(lastIndex) });
  }
  return segments;
}
